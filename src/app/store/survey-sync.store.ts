import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { inject, effect } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { IndexedDbService } from '../services/indexed-db.service';
import { ApiService } from '../services/api.service';
import { SseService } from '../services/sse.service';
import { SurveyTemplate, GenericSubmission, SubmissionLogEntry } from '../models/survey.model';

export interface SurveyState {
  isOnline: boolean;
  activeTemplate: SurveyTemplate | null;
  pendingSyncCount: number;
  syncing: boolean;
  liveStreamActive: boolean;
  templates: SurveyTemplate[];
  submissionsLog: SubmissionLogEntry[];
  history: GenericSubmission[];
  explorerSubmissions: GenericSubmission[];
  explorerTotalCount: number;
  explorerLoading: boolean;
  dashboardStats: any | null;
}

const initialState: SurveyState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  activeTemplate: null,
  pendingSyncCount: 0,
  syncing: false,
  liveStreamActive: false,
  templates: [],
  submissionsLog: [],
  history: [],
  explorerSubmissions: [],
  explorerTotalCount: 0,
  explorerLoading: false,
  dashboardStats: null
};

// Module-level SSE subscription — lives outside the store so it persists
let sseSubscription: Subscription | null = null;

export const SurveySyncStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, dbService = inject(IndexedDbService), apiService = inject(ApiService), sseService = inject(SseService)) => {

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
          const res = await firstValueFrom(apiService.getSubmissions(undefined, undefined, 100, 0));
          const pending = await dbService.getAllSubmissions();
          const combined = [
            ...pending.map(p => ({ ...p, status: 'Offline Cached' })),
            ...res.submissions.map(c => ({ ...c, status: 'Synced (Direct)' }))
          ];
          patchState(store, { history: combined });
        } catch (error) {
          console.error('[STORE] Failed to load cloud submissions:', error);
        }
      },

      async loadExplorerSubmissions(templateId: string, search: string, limit: number, offset: number) {
        patchState(store, { explorerLoading: true });
        try {
          if (store.isOnline() && apiService.isAuthenticated()) {
            const res = await firstValueFrom(apiService.getSubmissions(templateId, search, limit, offset));
            patchState(store, {
              explorerSubmissions: res.submissions,
              explorerTotalCount: res.total
            });
          } else {
            // Offline fallback: load from local IndexedDB history
            const localHistory = await dbService.getAllHistorySubmissions();
            const query = search.trim().toLowerCase();
            const filtered = localHistory.filter(item => {
              const matchesSurvey = item.template_id === templateId;
              const matchesSearch = query === '' || item.client_identifier.toLowerCase().includes(query) || (item.respondent_name && item.respondent_name.toLowerCase().includes(query)) || (item.respondent_email && item.respondent_email.toLowerCase().includes(query));
              return matchesSurvey && matchesSearch;
            });
            const paged = filtered.slice(offset, offset + limit);
            patchState(store, {
              explorerSubmissions: paged,
              explorerTotalCount: filtered.length
            });
          }
        } catch (error) {
          console.error('[STORE] Failed to load explorer submissions:', error);
        } finally {
          patchState(store, { explorerLoading: false });
        }
      },

      async loadDashboardStats(templateId: string) {
        if (store.isOnline() && apiService.isAuthenticated()) {
          try {
            const stats = await firstValueFrom(apiService.getSubmissionStats(templateId));
            patchState(store, { dashboardStats: stats });
            return;
          } catch (error) {
            console.warn('[STORE] Failed to load stats from server — calculating locally.', error);
          }
        }

        // Offline / Fallback: Compute statistics locally from IndexedDB history
        try {
          const localHistory = await dbService.getAllHistorySubmissions();
          const rows = localHistory.filter(h => h.template_id === templateId);
          const total = rows.length;

          let syncedCount = 0;
          const starSums: Record<string, number> = {};
          const starCountsForAvg: Record<string, number> = {};
          
          const optionCounts: Record<string, Record<string, number>> = {};
          const starCounts: Record<string, Record<number, number>> = {};
          const numericLists: Record<string, number[]> = {};
          const textComments: Record<string, { client: string; text: string; timestamp: string }[]> = {};

          for (const row of rows) {
            const status: string = row.status || '';
            if (status.toLowerCase().startsWith('synced') || status.toLowerCase().startsWith('submitted')) {
              syncedCount++;
            }

            const client = row.client_identifier || 'Unknown';
            const timestamp = row.timestamp || 'Unknown Time';
            const answers = row.answers || {};

            for (const [fieldKey, val] of Object.entries(answers)) {
              if (val === undefined || val === null || val === '') continue;

              const stringVal = String(val).trim();

              // 1. Check options
              if (!optionCounts[fieldKey]) optionCounts[fieldKey] = {};
              const choices = stringVal.split(',').map(c => c.trim());
              for (const choice of choices) {
                if (choice) {
                  optionCounts[fieldKey][choice] = (optionCounts[fieldKey][choice] || 0) + 1;
                }
              }

              // 2. Check numeric and star rating
              const numVal = Number(stringVal);
              if (!isNaN(numVal)) {
                if (!numericLists[fieldKey]) numericLists[fieldKey] = [];
                numericLists[fieldKey].push(numVal);

                const starRating = Math.round(numVal);
                if (starRating >= 1 && starRating <= 5) {
                  if (!starCounts[fieldKey]) {
                    starCounts[fieldKey] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
                  }
                  starCounts[fieldKey][starRating] = (starCounts[fieldKey][starRating] || 0) + 1;

                  starSums[fieldKey] = (starSums[fieldKey] || 0) + numVal;
                  starCountsForAvg[fieldKey] = (starCountsForAvg[fieldKey] || 0) + 1;
                }
              }

              // 3. Keep text responses
              if (stringVal.length > 0) {
                if (!textComments[fieldKey]) textComments[fieldKey] = [];
                if (textComments[fieldKey].length < 100) {
                  textComments[fieldKey].push({ client, text: stringVal, timestamp });
                }
              }
            }
          }

          // Averages
          const starAverages: Record<string, number> = {};
          for (const [key, sum] of Object.entries(starSums)) {
            const count = starCountsForAvg[key] || 0;
            starAverages[key] = count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
          }

          // Numeric Stats
          const numericStats: Record<string, { min: number | string; max: number | string; avg: number | string; count: number }> = {};
          for (const [key, list] of Object.entries(numericLists)) {
            if (list.length === 0) continue;
            const min = Math.min(...list);
            const max = Math.max(...list);
            const sum = list.reduce((a, b) => a + b, 0);
            const avg = parseFloat((sum / list.length).toFixed(1));
            numericStats[key] = { min, max, avg, count: list.length };
          }

          const syncPercentage = total > 0 ? Math.round((syncedCount / total) * 100) : 0;

          patchState(store, {
            dashboardStats: {
              total,
              syncPercentage,
              starAverages,
              optionCounts,
              starCounts,
              numericStats,
              textResponses: textComments
            }
          });
        } catch (err) {
          console.error('[STORE] Failed to compute local offline statistics:', err);
        }
      },

      startLiveStream(token: string) {
        // Avoid double-connecting
        if (sseSubscription || !token) return;

        patchState(store, { liveStreamActive: true });
        console.log('[SSE] Starting live results stream...');

        const stream$ = sseService.connect(token);
        sseSubscription = stream$.subscribe({
          next: (submission: GenericSubmission) => {
            // Deduplicate: skip if this UUID is already in history
            const existing = store.history().find(h => h.uuid && h.uuid === submission.uuid);
            if (existing) return;

            const templateName = store.templates().find(t => t.id === submission.template_id)?.name || 'Survey';
            const enriched: GenericSubmission = {
              ...submission,
              status: 'Synced (Direct)',
            };

            patchState(store, (state) => {
              // Prepend to history & submissions log
              const updatedHistory = [enriched, ...state.history];
              const updatedLogs = [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  client: submission.client_identifier,
                  status: 'Live ⬤',
                  templateName,
                },
                ...state.submissionsLog,
              ];

              // Dynamic real-time explorer & dashboard stats enrichment
              const activeDashboard = state.activeTemplate;
              let explorerSubmissions = state.explorerSubmissions;
              let explorerTotalCount = state.explorerTotalCount;
              let dashboardStats = state.dashboardStats;

              if (activeDashboard && submission.template_id === activeDashboard.id) {
                explorerSubmissions = [enriched, ...explorerSubmissions];
                explorerTotalCount = explorerTotalCount + 1;

                if (dashboardStats) {
                  const newTotal = dashboardStats.total + 1;
                  const starAverages = { ...dashboardStats.starAverages };
                  const starCounts = { ...dashboardStats.starCounts };
                  const optionCounts = { ...dashboardStats.optionCounts };
                  const numericStats = { ...dashboardStats.numericStats };
                  const textResponses = { ...dashboardStats.textResponses };

                  const answers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : (submission.answers || {});

                  for (const [fieldKey, val] of Object.entries(answers)) {
                    if (val === undefined || val === null || val === '') continue;
                    const stringVal = String(val).trim();

                    // Choice options counts
                    if (!optionCounts[fieldKey]) optionCounts[fieldKey] = {};
                    const choices = stringVal.split(',').map(c => c.trim());
                    for (const choice of choices) {
                      if (choice) {
                        optionCounts[fieldKey][choice] = (optionCounts[fieldKey][choice] || 0) + 1;
                      }
                    }

                    // Numeric/Star Rating
                    const numVal = Number(stringVal);
                    if (!isNaN(numVal)) {
                      // Numeric
                      const prevNum = numericStats[fieldKey] || { min: numVal, max: numVal, avg: 0, count: 0 };
                      const newCount = prevNum.count + 1;
                      const newMin = typeof prevNum.min === 'number' ? Math.min(prevNum.min, numVal) : numVal;
                      const newMax = typeof prevNum.max === 'number' ? Math.max(prevNum.max, numVal) : numVal;
                      const prevSum = typeof prevNum.avg === 'number' ? prevNum.avg * prevNum.count : 0;
                      const newAvg = parseFloat(((prevSum + numVal) / newCount).toFixed(1));
                      numericStats[fieldKey] = { min: newMin, max: newMax, avg: newAvg, count: newCount };

                      // Stars
                      const starRating = Math.round(numVal);
                      if (starRating >= 1 && starRating <= 5) {
                        if (!starCounts[fieldKey]) {
                          starCounts[fieldKey] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
                        }
                        starCounts[fieldKey][starRating] = (starCounts[fieldKey][starRating] || 0) + 1;

                        let starSum = 0;
                        let starTotal = 0;
                        for (let r = 1; r <= 5; r++) {
                          const c = starCounts[fieldKey][r] || 0;
                          starSum += r * c;
                          starTotal += c;
                        }
                        starAverages[fieldKey] = starTotal > 0 ? parseFloat((starSum / starTotal).toFixed(1)) : 0;
                      }
                    }

                    // Text Commentary
                    if (stringVal.length > 0) {
                      if (!textResponses[fieldKey]) textResponses[fieldKey] = [];
                      textResponses[fieldKey] = [
                        { client: submission.client_identifier, text: stringVal, timestamp: new Date().toLocaleTimeString() },
                        ...textResponses[fieldKey]
                      ].slice(0, 100);
                    }
                  }

                  dashboardStats = {
                    ...dashboardStats,
                    total: newTotal,
                    syncPercentage: 100,
                    starAverages,
                    optionCounts,
                    starCounts,
                    numericStats,
                    textResponses
                  };
                }
              }

              return {
                history: updatedHistory,
                submissionsLog: updatedLogs,
                explorerSubmissions,
                explorerTotalCount,
                dashboardStats
              };
            });
          },
          error: () => {
            patchState(store, { liveStreamActive: false });
            sseSubscription = null;
          },
          complete: () => {
            patchState(store, { liveStreamActive: false });
            sseSubscription = null;
          },
        });
      },

      stopLiveStream() {
        sseService.disconnect();
        if (sseSubscription) {
          sseSubscription.unsubscribe();
          sseSubscription = null;
        }
        patchState(store, { liveStreamActive: false });
        console.log('[SSE] Live results stream stopped.');
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
