import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GenericSurveyFormComponent } from './components/generic-survey-form/generic-survey-form.component';
import { SurveyCreatorComponent } from './components/survey-creator/survey-creator.component';
import { SurveySyncStore } from './store/survey-sync.store';
import { ApiService } from './services/api.service';
import { SurveyTemplate, GenericSubmission } from './models/survey.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [GenericSurveyFormComponent, SurveyCreatorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(SurveySyncStore);
  readonly api = inject(ApiService);
  readonly currentTab = signal<'home' | 'survey-wizard' | 'creator' | 'results'>('home');

  readonly activeDashboardTemplate = signal<SurveyTemplate | null>(null);
  readonly resultsSearchQuery = signal<string>('');

  // ─── Pagination Signals ───────────────────────────────────────────────────
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(10);
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Direct Share & Toast Notification Signals ────────────────────────────
  readonly isDirectShareLink = signal<boolean>(false);
  readonly toastMessage = signal<string>('');
  readonly toastIcon = signal<string>('🔗'); // default: link icon
  readonly editingTemplate = signal<SurveyTemplate | null>(null);

  // Auto-sync: reference kept for ngOnDestroy cleanup
  private readonly autoSyncOnlineHandler: () => void;
  private autoSyncToastTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Admin Login Modal State ─────────────────────────────────────────────
  readonly showLoginModal = signal<boolean>(false);
  readonly loginUsername = signal<string>('');
  readonly loginPassword = signal<string>('');
  readonly loginError = signal<string>('');
  readonly loginLoading = signal<boolean>(false);
  readonly isAdminAuthenticated = signal<boolean>(false);
  private pendingAdminTab: 'creator' | 'results' | null = null;

  constructor() {
    // Build the online handler once so we can remove the exact same reference in ngOnDestroy
    this.autoSyncOnlineHandler = () => {
      if (this.autoSyncToastTimer) clearTimeout(this.autoSyncToastTimer);
      // Match the 1.5 s debounce used in the store so the toast fires right after sync starts
      this.autoSyncToastTimer = setTimeout(() => {
        if (this.store.pendingSyncCount() > 0 || this.store.syncing()) {
          this.showToast('✨ Local responses synchronized with cloud!', '✨');
        }
      }, 1600);
    };
  }

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

  showToast(message: string, icon = '🔗') {
    this.toastIcon.set(icon);
    this.toastMessage.set(message);
    setTimeout(() => {
      this.toastMessage.set('');
    }, 3500);
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

    // 3. Register the auto-sync toast listener (store handles actual sync)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.autoSyncOnlineHandler);
    }

    // 4. Check for Direct Share Link (?survey=template_id)
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

  ngOnDestroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.autoSyncOnlineHandler);
    }
    if (this.autoSyncToastTimer) clearTimeout(this.autoSyncToastTimer);
  }

  selectTemplateAndFullscreen(template: SurveyTemplate) {
    this.store.selectTemplate(template);
    this.currentTab.set('survey-wizard');
    this.enterFullscreen();
  }

  // ─── Admin Navigation Gate ───────────────────────────────────────────────
  navigateToAdmin(tab: 'creator' | 'results') {
    // If we are leaving the results tab, stop the live stream first
    if (this.currentTab() === 'results' && tab !== 'results') {
      this.store.stopLiveStream();
    }

    if (this.isAdminAuthenticated()) {
      // When navigating to results, start the live stream using the stored JWT
      if (tab === 'results') {
        const token = this.api.getToken();
        if (token) this.store.startLiveStream(token);
      }
      // When navigating to creator, clear any edit state
      if (tab === 'creator') this.editingTemplate.set(null);
      this.currentTab.set(tab);
      if (tab === 'results') {
        this.store.loadSubmissionsFromCloud();
      }
    } else {
      // Prompt login flow for admin pages
      this.pendingAdminTab = tab;
      this.showLoginModal.set(true);
    }
  }

  startEditTemplate(template: SurveyTemplate) {
    this.editingTemplate.set(template);
    this.currentTab.set('creator');
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

  async exportToCsv() {
    const active = this.activeDashboardTemplate();
    if (!active) return;

    let subs: GenericSubmission[] = [];
    if (this.store.isOnline() && this.api.isAuthenticated()) {
      try {
        this.showToast('Generating CSV report...', '📥');
        const res = await firstValueFrom(this.api.getSubmissions(active.id, undefined, 100000, 0));
        subs = res.submissions;
      } catch (error) {
        console.error('[CSV] Failed to fetch cloud records for export:', error);
        this.showToast('Failed to load cloud history.');
        return;
      }
    } else {
      // Offline fallback: load from local history
      subs = this.store.history().filter(s => s.template_id === active.id);
    }

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

    this.showToast('CSV report downloaded!', '📥');
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

  // ─── Dashboard Pagination & Search Controllers ─────────────────────────────
  selectDashboardTemplate(template: SurveyTemplate) {
    this.activeDashboardTemplate.set(template);
    this.currentPage.set(1);
    this.resultsSearchQuery.set('');
    this.store.loadDashboardStats(template.id);
    this.loadCurrentPage();
  }

  closeDashboard() {
    this.activeDashboardTemplate.set(null);
    this.resultsSearchQuery.set('');
    this.currentPage.set(1);
  }

  async loadCurrentPage() {
    const active = this.activeDashboardTemplate();
    if (!active) return;

    const search = this.resultsSearchQuery();
    const limit = this.pageSize();
    const offset = (this.currentPage() - 1) * limit;

    await this.store.loadExplorerSubmissions(active.id, search, limit, offset);
  }

  onSearchQueryInput(query: string) {
    this.resultsSearchQuery.set(query);
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage.set(1);
      this.loadCurrentPage();
    }, 300);
  }

  goToPage(page: number) {
    const totalPages = this.totalPages();
    if (page < 1 || page > totalPages) return;
    this.currentPage.set(page);
    this.loadCurrentPage();
  }

  changePageSize(size: number) {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  readonly totalPages = computed(() => {
    const total = this.store.explorerTotalCount();
    const size = this.pageSize();
    return Math.ceil(total / size) || 1;
  });

  readonly visiblePages = computed(() => {
    const current = this.currentPage();
    const total = this.totalPages();
    const pages: number[] = [];
    
    // Show up to 5 page choices around current
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) {
      start = Math.max(1, end - 4);
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  });

  readonly showingStart = computed(() => {
    if (this.store.explorerTotalCount() === 0) return 0;
    return ((this.currentPage() - 1) * this.pageSize()) + 1;
  });

  readonly showingEnd = computed(() => {
    const end = this.currentPage() * this.pageSize();
    const total = this.store.explorerTotalCount();
    return end > total ? total : end;
  });

  // ─── Refactored Analytical Helper Methods ─────────────────────────────────
  getAverageStarRating(templateId: string, fieldKey: string): number {
    const stats = this.store.dashboardStats();
    if (stats && stats.starAverages) {
      return stats.starAverages[fieldKey] || 0;
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats && stats.optionCounts && stats.optionCounts[fieldKey]) {
      return stats.optionCounts[fieldKey][option] || 0;
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats) {
      const total = stats.total || 0;
      if (total === 0) return 0;
      const count = this.getOptionCount(templateId, fieldKey, option);
      return Math.round((count / total) * 100);
    }
    // Fallback
    const total = this.store.history().filter(s => s.template_id === templateId).length;
    if (total === 0) return 0;
    const count = this.getOptionCount(templateId, fieldKey, option);
    return Math.round((count / total) * 100);
  }

  getStarRatingCount(templateId: string, fieldKey: string, star: number): number {
    const stats = this.store.dashboardStats();
    if (stats && stats.starCounts && stats.starCounts[fieldKey]) {
      return stats.starCounts[fieldKey][star] || 0;
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats) {
      const starCountsGroup = stats.starCounts && stats.starCounts[fieldKey];
      let validCount = 0;
      if (starCountsGroup) {
        for (let r = 1; r <= 5; r++) {
          validCount += starCountsGroup[r] || 0;
        }
      }
      if (validCount === 0) return 0;
      const count = this.getStarRatingCount(templateId, fieldKey, star);
      return Math.round((count / validCount) * 100);
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats && stats.numericStats && stats.numericStats[fieldKey]) {
      return stats.numericStats[fieldKey];
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats && stats.textResponses && stats.textResponses[fieldKey]) {
      return stats.textResponses[fieldKey];
    }
    // Fallback
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
    const stats = this.store.dashboardStats();
    if (stats && stats.syncPercentage !== undefined) {
      return stats.syncPercentage;
    }
    // Fallback
    const subs = this.store.history().filter(s => s.template_id === templateId);
    if (subs.length === 0) return 0;
    const synced = subs.filter(s => s.status && s.status.toLowerCase().startsWith('synced')).length;
    return Math.round((synced / subs.length) * 100);
  }
}
