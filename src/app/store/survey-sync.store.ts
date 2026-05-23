import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { inject, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IndexedDbService } from '../services/indexed-db.service';
import { ApiService } from '../services/api.service';
import { SurveyTemplate, GenericSubmission, SubmissionLogEntry } from '../models/survey.model';

export interface SurveyState {
  isOnline: boolean;
  activeTemplate: SurveyTemplate | null;
  pendingSyncCount: number;
  syncing: boolean;
  templates: SurveyTemplate[];
  submissionsLog: SubmissionLogEntry[];
  history: GenericSubmission[];
}

const initialState: SurveyState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  activeTemplate: null,
  pendingSyncCount: 0,
  syncing: false,
  templates: [],
  submissionsLog: [],
  history: []
};

export const SurveySyncStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, dbService = inject(IndexedDbService), apiService = inject(ApiService)) => {

    // Send one submission to the real backend API
    const sendToCloudDatabase = async (submission: GenericSubmission): Promise<void> => {
      await firstValueFrom(apiService.saveSubmission(submission));
    };

    const updatePendingCount = async () => {
      const count = await dbService.getCount();
      patchState(store, { pendingSyncCount: count });
    };

    const syncPendingSubmissions = async () => {
      if (!store.isOnline() || store.syncing() || store.pendingSyncCount() === 0) return;

      patchState(store, { syncing: true });
      try {
        const pending = await dbService.getAllSubmissions();
        for (const sub of pending) {
          await sendToCloudDatabase(sub);
          if (sub.id) {
            await dbService.deleteSubmission(sub.id);
          }

          if (sub.uuid) {
            await dbService.updateHistoryStatusByUuid(sub.uuid, 'Synced (Reconnected)');
            patchState(store, (state) => ({
              history: state.history.map(h =>
                h.uuid === sub.uuid ? { ...h, status: 'Synced (Reconnected)' } : h
              )
            }));
          }

          const templateName = store.templates().find(t => t.id === sub.template_id)?.name || 'Survey';
          patchState(store, (state) => ({
            submissionsLog: [
              {
                timestamp: new Date().toLocaleTimeString(),
                client: sub.client_identifier,
                status: 'Synced (Reconnected)',
                templateName
              },
              ...state.submissionsLog
            ]
          }));
        }
        await updatePendingCount();
      } catch (error) {
        console.error('[STORE] Failed to sync offline submissions:', error);
      } finally {
        patchState(store, { syncing: false });
      }
    };

    return {
      async initStore(seedTemplates: SurveyTemplate[]) {
        if (typeof window !== 'undefined') {
          // Track reconnection and auto-sync pending offline submissions
          let reconnectDebounce: ReturnType<typeof setTimeout> | null = null;

          window.addEventListener('online', () => {
            patchState(store, { isOnline: true });
            // Debounce: wait 1.5 s for connection to stabilise before syncing
            if (reconnectDebounce) clearTimeout(reconnectDebounce);
            reconnectDebounce = setTimeout(() => {
              syncPendingSubmissions();
            }, 1500);
          });

          window.addEventListener('offline', () => {
            if (reconnectDebounce) clearTimeout(reconnectDebounce);
            patchState(store, { isOnline: false });
          });

          patchState(store, { isOnline: navigator.onLine });
        }

        let templates: SurveyTemplate[] = [];

        // Load templates from API, fall back to IndexedDB cache when offline
        try {
          templates = await firstValueFrom(apiService.getTemplates());
          for (const t of templates) {
            await dbService.saveTemplate(t);
          }
        } catch {
          console.warn('[STORE] API unreachable — loading templates from local IndexedDB cache.');
          templates = await dbService.getAllTemplates();
        }

        // Field key deduplication / migration for legacy data
        let needsDbUpdate = false;
        const upgraded = templates.map(template => {
          const seen = new Set<string>();
          let changed = false;
          const fields = template.fields.map((field, idx) => {
            let key = (field.key || '').trim();
            if (!key || seen.has(key)) {
              changed = true;
              let base = key || (field.label || '').toLowerCase()
                .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').trim() || 'question';
              let newKey = `${base}_${idx + 1}`;
              let c = 1;
              while (seen.has(newKey)) newKey = `${base}_${idx + 1}_${c++}`;
              key = newKey;
            }
            seen.add(key);
            return { ...field, key };
          });
          if (changed) { needsDbUpdate = true; return { ...template, fields }; }
          return template;
        });

        if (needsDbUpdate) {
          for (const t of upgraded) await dbService.saveTemplate(t);
          templates = upgraded;
        }

        // Seed defaults if both API and IndexedDB are empty
        if (templates.length === 0 && seedTemplates.length > 0) {
          for (const t of seedTemplates) {
            await dbService.saveTemplate(t);
            if (store.isOnline()) {
              try { await firstValueFrom(apiService.saveTemplate(t)); } catch { /* ignore */ }
            }
          }
          templates = [...seedTemplates];
        }

        const savedHistory = await dbService.getAllHistorySubmissions();
        patchState(store, {
          templates,
          activeTemplate: templates[0] || null,
          history: savedHistory
        });
        await updatePendingCount();
      },

      selectTemplate(template: SurveyTemplate) {
        patchState(store, { activeTemplate: template });
      },

      async createCustomTemplate(template: SurveyTemplate) {
        await dbService.saveTemplate(template);
        if (store.isOnline()) {
          try { await firstValueFrom(apiService.saveTemplate(template)); } catch { /* offline queue later */ }
        }
        patchState(store, (state) => ({
          templates: [...state.templates, template],
          activeTemplate: template
        }));
      },

      async updateCustomTemplate(template: SurveyTemplate) {
        // Persist updated schema to local IndexedDB cache
        await dbService.saveTemplate(template);
        // Sync updated schema to the cloud API if online
        if (store.isOnline()) {
          try { await firstValueFrom(apiService.updateTemplate(template)); } catch { /* offline, changes are in IndexedDB */ }
        }
        // Replace the old template entry in the reactive state list
        patchState(store, (state) => ({
          templates: state.templates.map(t => t.id === template.id ? template : t),
          activeTemplate: state.activeTemplate?.id === template.id ? template : state.activeTemplate
        }));
      },

      async deleteCustomTemplate(id: string) {
        await dbService.deleteTemplate(id);
        if (store.isOnline()) {
          try { await firstValueFrom(apiService.deleteTemplate(id)); } catch { /* ignore */ }
        }
        patchState(store, (state) => {
          const updated = state.templates.filter(t => t.id !== id);
          return {
            templates: updated,
            activeTemplate: state.activeTemplate?.id === id ? (updated[0] || null) : state.activeTemplate
          };
        });
      },

      async deleteHistoryEntry(id: number) {
        await dbService.deleteHistorySubmission(id);
        if (store.isOnline() && apiService.isAuthenticated()) {
          try { await firstValueFrom(apiService.deleteSubmission(id)); } catch { /* ignore */ }
        }
        patchState(store, (state) => ({ history: state.history.filter(h => h.id !== id) }));
      },

      async clearAllHistory() {
        await dbService.clearHistorySubmissions();
        patchState(store, { history: [] });
      },

      syncPendingSubmissions,

      async loadSubmissionsFromCloud() {
        if (!store.isOnline() || !apiService.isAuthenticated()) return;
        try {
          const cloud = await firstValueFrom(apiService.getSubmissions());
          const pending = await dbService.getAllSubmissions();
          const combined = [
            ...pending.map(p => ({ ...p, status: 'Offline Cached' })),
            ...cloud.map(c => ({ ...c, status: 'Synced (Direct)' }))
          ];
          patchState(store, { history: combined });
        } catch (error) {
          console.error('[STORE] Failed to load cloud submissions:', error);
        }
      },

      async saveGenericSubmission(payload: Omit<GenericSubmission, 'id'>) {
        const isOnline = store.isOnline();
        const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const timestamp = new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

        const submission: GenericSubmission = {
          ...payload,
          uuid,
          timestamp,
          status: isOnline ? 'Synced (Direct)' : 'Offline Cached'
        };

        // Always persist locally first
        const historyId = await dbService.addHistorySubmission(submission);
        patchState(store, (state) => ({ history: [{ ...submission, id: historyId }, ...state.history] }));

        if (isOnline) {
          try {
            patchState(store, { syncing: true });
            await sendToCloudDatabase(submission);
            patchState(store, (state) => ({
              syncing: false,
              submissionsLog: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  client: payload.client_identifier,
                  status: 'Synced (Direct)',
                  templateName: state.templates.find(t => t.id === payload.template_id)?.name || 'Survey'
                },
                ...state.submissionsLog
              ]
            }));
          } catch {
            // API failed — queue for later sync
            const offlineStatus = 'Offline Cached';
            await dbService.updateHistoryStatusByUuid(uuid, offlineStatus);
            await dbService.addSubmission(submission);
            await updatePendingCount();
            patchState(store, (state) => ({
              syncing: false,
              history: state.history.map(h => h.uuid === uuid ? { ...h, status: offlineStatus } : h),
              submissionsLog: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  client: payload.client_identifier,
                  status: 'Saved Offline',
                  templateName: state.templates.find(t => t.id === payload.template_id)?.name || 'Survey'
                },
                ...state.submissionsLog
              ]
            }));
          }
        } else {
          await dbService.addSubmission(submission);
          await updatePendingCount();
          patchState(store, (state) => ({
            submissionsLog: [
              {
                timestamp: new Date().toLocaleTimeString(),
                client: payload.client_identifier,
                status: 'Saved Offline',
                templateName: state.templates.find(t => t.id === payload.template_id)?.name || 'Survey'
              },
              ...state.submissionsLog
            ]
          }));
        }
      }
    };
  }),
  withHooks({
    onInit(store) {
      effect(() => {
        if (store.isOnline()) {
          store.syncPendingSubmissions();
        }
      }, { allowSignalWrites: true });
    }
  })
);
