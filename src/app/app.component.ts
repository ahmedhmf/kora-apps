import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { GenericSurveyFormComponent } from './components/generic-survey-form/generic-survey-form.component';
import { SurveyCreatorComponent } from './components/survey-creator/survey-creator.component';
import { SurveySyncStore } from './store/survey-sync.store';
import { ApiService } from './services/api.service';
import { SurveyTemplate } from './models/survey.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [GenericSurveyFormComponent, SurveyCreatorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly store = inject(SurveySyncStore);
  readonly api = inject(ApiService);
  readonly currentTab = signal<'home' | 'survey-wizard' | 'creator' | 'results'>('home');

  readonly activeDashboardTemplate = signal<SurveyTemplate | null>(null);
  readonly resultsSearchQuery = signal<string>('');

  // ─── Direct Share & Toast Notification Signals ────────────────────────────
  readonly isDirectShareLink = signal<boolean>(false);
  readonly toastMessage = signal<string>('');

  // ─── Admin Login Modal State ─────────────────────────────────────────────
  readonly showLoginModal = signal<boolean>(false);
  readonly loginUsername = signal<string>('');
  readonly loginPassword = signal<string>('');
  readonly loginError = signal<string>('');
  readonly loginLoading = signal<boolean>(false);
  readonly isAdminAuthenticated = signal<boolean>(false);
  private pendingAdminTab: 'creator' | 'results' | null = null;

  readonly dashboardSubmissions = computed(() => {
    const active = this.activeDashboardTemplate();
    if (!active) return [];
    const query = this.resultsSearchQuery().trim().toLowerCase();

    return this.store.history().filter(item => {
      const matchesSurvey = item.template_id === active.id;
      const matchesSearch = query === '' || item.client_identifier.toLowerCase().includes(query);
      return matchesSurvey && matchesSearch;
    });
  });

  // Hardcoded survey schema templates for previewing the engine on iPad offline
  private readonly mockTemplates: SurveyTemplate[] = [
    {
      id: 'customer_satisfaction',
      name: 'Customer Satisfaction Survey',
      description: 'Dynamic feedback evaluation used to analyze client experiences and rating indicators during visits.',
      fields: [
        {
          key: 'overall_rating',
          label: 'Overall Satisfaction Level',
          type: 'dropdown',
          placeholder: 'Select a rating',
          options: ['Excellent (5 Stars)', 'Good (4 Stars)', 'Satisfactory (3 Stars)', 'Needs Improvement (2 Stars)', 'Poor (1 Star)'],
          required: true
        },
        {
          key: 'primary_contact_reason',
          label: 'Primary Reason for Contact',
          type: 'dropdown',
          placeholder: 'Select department',
          options: ['Account Management', 'Technical Support', 'Billing Consultation', 'New Product Inquiry'],
          required: true
        },
        {
          key: 'feedback_comments',
          label: 'Detailed Client Feedback Comments',
          type: 'text',
          placeholder: 'Add any specific notes or improvement recommendations...',
          required: false
        },
        {
          key: 'followup_days',
          label: 'Requested Follow-up Schedule (Days)',
          type: 'number',
          placeholder: 'Enter number of days (e.g. 7)',
          required: true
        }
      ]
    },
    {
      id: 'technical_audit',
      name: 'Technical Audit Form',
      description: 'On-site technical evaluation to inspect system levels, hardware performance, and environment status.',
      fields: [
        {
          key: 'system_health',
          label: 'Primary System Health Status',
          type: 'dropdown',
          placeholder: 'Select hardware status',
          options: ['Fully Operational', 'Degraded Performance', 'Critical Subsystem Failure', 'Complete Outage'],
          required: true
        },
        {
          key: 'operating_temp',
          label: 'Server Rack Temperature (Celsius)',
          type: 'number',
          placeholder: 'e.g. 24',
          required: true
        },
        {
          key: 'audit_notes',
          label: 'Audit Findings & Observations',
          type: 'text',
          placeholder: 'Describe visual hardware indicators or active faults...',
          required: false
        }
      ]
    }
  ];

  readonly isFullscreen = signal<boolean>(false);

  showToast(message: string) {
    this.toastMessage.set(message);
    setTimeout(() => {
      this.toastMessage.set('');
    }, 3000);
  }

  copyShareLink(templateId: string) {
    const shareUrl = `${window.location.origin}/?survey=${templateId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      this.showToast('Shareable survey link copied!');
    }).catch(err => {
      console.error('[AUTH] Failed to copy link:', err);
      this.showToast('Failed to copy share link.');
    });
  }

  async ngOnInit() {
    // 1. Seed and load all active templates from server/local
    await this.store.initStore(this.mockTemplates);
    this.setupFullscreenListener();

    // 2. Restore admin session from sessionStorage if token is still valid
    const isAuthed = this.api.isAuthenticated();
    this.isAdminAuthenticated.set(isAuthed);
    if (isAuthed) {
      this.store.loadSubmissionsFromCloud();
    }

    // 3. Check for Direct Share Link (?survey=template_id)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const surveyId = params.get('survey');
      if (surveyId) {
        const template = this.store.templates().find(t => t.id === surveyId);
        if (template) {
          this.isDirectShareLink.set(true);
          this.store.selectTemplate(template);
          this.currentTab.set('survey-wizard');
        } else {
          console.warn(`[AUTH] Direct share survey template "${surveyId}" not found in current schema.`);
        }
      }
    }
  }

  selectTemplateAndFullscreen(template: SurveyTemplate) {
    this.store.selectTemplate(template);
    this.currentTab.set('survey-wizard');
    this.enterFullscreen();
  }

  // ─── Admin Navigation Gate ───────────────────────────────────────────────
  navigateToAdmin(tab: 'creator' | 'results') {
    if (this.isAdminAuthenticated()) {
      this.currentTab.set(tab);
      if (tab === 'results') {
        this.store.loadSubmissionsFromCloud();
      }
    } else {
      this.pendingAdminTab = tab;
      this.loginError.set('');
      this.loginUsername.set('');
      this.loginPassword.set('');
      this.showLoginModal.set(true);
    }
  }

  async submitLogin() {
    const username = this.loginUsername().trim();
    const password = this.loginPassword();
    if (!username || !password) {
      this.loginError.set('Please enter both username and password.');
      return;
    }
    this.loginLoading.set(true);
    this.loginError.set('');
    try {
      const result = await new Promise<{ token: string; username: string }>((resolve, reject) => {
        this.api.login(username, password).subscribe({ next: resolve, error: reject });
      });
      this.api.saveToken(result.token);
      this.isAdminAuthenticated.set(true);
      this.showLoginModal.set(false);
      if (this.pendingAdminTab) {
        this.currentTab.set(this.pendingAdminTab);
        if (this.pendingAdminTab === 'results') {
          this.store.loadSubmissionsFromCloud();
        }
        this.pendingAdminTab = null;
      }
    } catch (err: any) {
      this.loginError.set(err?.message || 'Invalid credentials. Please try again.');
    } finally {
      this.loginLoading.set(false);
    }
  }

  logoutAdmin() {
    this.api.clearToken();
    this.isAdminAuthenticated.set(false);
    this.currentTab.set('home');
  }

  cancelLogin() {
    this.showLoginModal.set(false);
    this.pendingAdminTab = null;
    this.loginError.set('');
  }

  enterFullscreen() {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(err => {
        console.warn('Fullscreen entry failed:', err);
      });
    } else if ((docEl as any).webkitRequestFullscreen) {
      (docEl as any).webkitRequestFullscreen();
    } else if ((docEl as any).mozRequestFullScreen) {
      (docEl as any).mozRequestFullScreen();
    } else if ((docEl as any).msRequestFullscreen) {
      (docEl as any).msRequestFullscreen();
    }
  }

  exitFullscreen() {
    const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement);
    if (isFull) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn('Exit fullscreen failed:', err));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  }

  toggleFullscreen() {
    const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement);
    if (isFull) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn('Exit fullscreen failed:', err));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    } else {
      this.enterFullscreen();
    }
  }

  setupFullscreenListener() {
    const onChange = () => {
      const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement);
      this.isFullscreen.set(isFull);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('mozfullscreenchange', onChange);
    document.addEventListener('MSFullscreenChange', onChange);
  }

  getTemplateName(templateId: string): string {
    const template = this.store.templates().find(t => t.id === templateId);
    return template ? template.name : 'Unknown Survey';
  }

  getTemplateFields(templateId: string) {
    const template = this.store.templates().find(t => t.id === templateId);
    return template ? template.fields : [];
  }

  exportToCsv() {
    const active = this.activeDashboardTemplate();
    if (!active) return;

    const subs = this.dashboardSubmissions();
    if (subs.length === 0) {
      this.showToast('No submissions to export.');
      return;
    }

    // 1. Build CSV headers (including standard metadata and PII)
    const headers = [
      'Submission ID',
      'Timestamp',
      'Respondent Name',
      'Respondent Email',
      'Is Anonymous',
      'Kiosk Identifier'
    ];

    // Append dynamic template field labels as headers
    const fields = active.fields;
    for (const f of fields) {
      // Escape quotes in column headers
      headers.push(`"${f.label.replace(/"/g, '""')}"`);
    }

    const csvRows = [headers.join(',')];

    // 2. Map submissions data into CSV rows
    for (const sub of subs) {
      const row = [
        `"${(sub.id || sub.uuid || '').toString().replace(/"/g, '""')}"`,
        `"${(sub.timestamp || '').replace(/"/g, '""')}"`,
        `"${(sub.respondent_name || '').replace(/"/g, '""')}"`,
        `"${(sub.respondent_email || '').replace(/"/g, '""')}"`,
        `"${sub.is_anonymous ? 'Yes' : 'No'}"`,
        `"${(sub.client_identifier || '').replace(/"/g, '""')}"`
      ];

      // Map dynamic answers based on key matching
      for (const f of fields) {
        const answer = sub.answers[f.key] || '';
        row.push(`"${answer.replace(/"/g, '""')}"`);
      }

      csvRows.push(row.join(','));
    }

    // 3. Assemble blob and trigger client-side download
    // FEFF is the UTF-8 Byte Order Mark (BOM) which prevents Excel from corrupting non-ASCII symbols
    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    const cleanFilename = active.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    link.setAttribute('href', url);
    link.setAttribute('download', `kora_export_${cleanFilename}_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showToast('CSV report downloaded!');
  }

  async confirmClearHistory() {
    if (confirm('Are you sure you want to permanently delete all local results from this iPad? This cannot be undone.')) {
      await this.store.clearAllHistory();
      this.activeDashboardTemplate.set(null);
    }
  }

  async deleteHistoryEntry(id: number) {
    if (confirm('Are you sure you want to delete this result?')) {
      await this.store.deleteHistoryEntry(id);
    }
  }

  async clearTemplateHistory(templateId: string) {
    if (confirm('Are you sure you want to permanently delete all local results for this specific survey from this device? This cannot be undone.')) {
      const recordsToDelete = this.store.history().filter(h => h.template_id === templateId);
      for (const rec of recordsToDelete) {
        if (rec.id) {
          await this.store.deleteHistoryEntry(rec.id);
        }
      }
      this.activeDashboardTemplate.set(null); // Return to overview card grid
    }
  }

  getAverageStarRating(templateId: string, fieldKey: string): number {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    if (subs.length === 0) return 0;
    let sum = 0;
    let count = 0;
    for (const sub of subs) {
      const val = sub.answers[fieldKey];
      if (val) {
        sum += +val;
        count++;
      }
    }
    return count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
  }

  getOptionCount(templateId: string, fieldKey: string, option: string): number {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    let count = 0;
    for (const sub of subs) {
      const val = sub.answers[fieldKey] || '';
      const parts = val.split(',').map(s => s.trim());
      if (parts.includes(option)) {
        count++;
      }
    }
    return count;
  }

  getOptionPercentage(templateId: string, fieldKey: string, option: string): number {
    const total = this.store.history().filter(s => s.template_id === templateId).length;
    if (total === 0) return 0;
    const count = this.getOptionCount(templateId, fieldKey, option);
    return Math.round((count / total) * 100);
  }

  getStarRatingCount(templateId: string, fieldKey: string, star: number): number {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    let count = 0;
    for (const sub of subs) {
      const val = sub.answers[fieldKey];
      if (val !== undefined && val !== null && val !== '') {
        if (Math.round(+val) === star) {
          count++;
        }
      }
    }
    return count;
  }

  getStarRatingPercentage(templateId: string, fieldKey: string, star: number): number {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    const validSubs = subs.filter(s => {
      const val = s.answers[fieldKey];
      return val !== undefined && val !== null && val !== '';
    });
    if (validSubs.length === 0) return 0;
    const count = this.getStarRatingCount(templateId, fieldKey, star);
    return Math.round((count / validSubs.length) * 100);
  }

  getNumericStats(templateId: string, fieldKey: string) {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    const nums: number[] = [];
    for (const sub of subs) {
      const val = sub.answers[fieldKey];
      if (val !== undefined && val !== null && val !== '') {
        const parsed = Number(val);
        if (!isNaN(parsed)) {
          nums.push(parsed);
        }
      }
    }
    if (nums.length === 0) {
      return { min: 'N/A', max: 'N/A', avg: 'N/A', count: 0 };
    }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = parseFloat((sum / nums.length).toFixed(1));
    return { min, max, avg, count: nums.length };
  }

  getTextResponses(templateId: string, fieldKey: string) {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    const results: { client: string; text: string; timestamp: string }[] = [];
    for (const sub of subs) {
      const val = sub.answers[fieldKey];
      if (val && val.trim().length > 0) {
        results.push({
          client: sub.client_identifier,
          text: val.trim(),
          timestamp: sub.timestamp || 'Unknown Time'
        });
      }
    }
    return results;
  }

  getSyncPercentage(templateId: string): number {
    const subs = this.store.history().filter(s => s.template_id === templateId);
    if (subs.length === 0) return 0;
    const synced = subs.filter(s => s.status && s.status.toLowerCase().startsWith('synced')).length;
    return Math.round((synced / subs.length) * 100);
  }
}
