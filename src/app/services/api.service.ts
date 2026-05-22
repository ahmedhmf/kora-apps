import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SurveyTemplate, GenericSubmission } from '../models/survey.model';

const SESSION_KEY = 'survay_admin_token';

export interface LoginResponse {
  token: string;
  username: string;
  expiresIn: string;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);

  // Base URL is relative — works both locally (via proxy.conf.json) and in production (via Nginx)
  private readonly base = '/api';

  // ─── Admin Session ──────────────────────────────────────────────────────────

  getToken(): string | null {
    return sessionStorage.getItem(SESSION_KEY);
  }

  saveToken(token: string): void {
    sessionStorage.setItem(SESSION_KEY, token);
  }

  clearToken(): void {
    sessionStorage.removeItem(SESSION_KEY);
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;

    // Decode payload (no verification — server verifies on each request)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  private get authHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.getToken() ?? ''}`,
      'Content-Type': 'application/json',
    });
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login`, { username, password })
      .pipe(catchError(this.handleError));
  }

  // ─── Templates (public read, admin write) ───────────────────────────────────

  getTemplates(): Observable<SurveyTemplate[]> {
    return this.http
      .get<SurveyTemplate[]>(`${this.base}/templates`)
      .pipe(catchError(this.handleError));
  }

  saveTemplate(template: SurveyTemplate): Observable<{ message: string; id: string }> {
    return this.http
      .post<{ message: string; id: string }>(`${this.base}/templates`, template, {
        headers: this.authHeaders,
      })
      .pipe(catchError(this.handleError));
  }

  deleteTemplate(id: string): Observable<{ message: string }> {
    return this.http
      .delete<{ message: string }>(`${this.base}/templates/${id}`, {
        headers: this.authHeaders,
      })
      .pipe(catchError(this.handleError));
  }

  // ─── Submissions (public write, admin read) ─────────────────────────────────

  saveSubmission(submission: Omit<GenericSubmission, 'id'>): Observable<{ message: string; id: number | null }> {
    return this.http
      .post<{ message: string; id: number | null }>(`${this.base}/submissions`, submission)
      .pipe(catchError(this.handleError));
  }

  getSubmissions(templateId?: string, search?: string): Observable<GenericSubmission[]> {
    let params = new HttpParams();
    if (templateId) params = params.set('template_id', templateId);
    if (search)     params = params.set('search', search);

    return this.http
      .get<GenericSubmission[]>(`${this.base}/submissions`, {
        headers: this.authHeaders,
        params,
      })
      .pipe(catchError(this.handleError));
  }

  deleteSubmission(id: number): Observable<{ message: string }> {
    return this.http
      .delete<{ message: string }>(`${this.base}/submissions/${id}`, {
        headers: this.authHeaders,
      })
      .pipe(catchError(this.handleError));
  }

  // ─── Error handler ──────────────────────────────────────────────────────────

  private handleError(error: any): Observable<never> {
    const message =
      error?.error?.error ||
      error?.message ||
      'An unexpected error occurred.';
    return throwError(() => new Error(message));
  }
}
