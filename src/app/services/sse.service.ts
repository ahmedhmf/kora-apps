import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { GenericSubmission } from '../models/survey.model';

@Injectable({ providedIn: 'root' })
export class SseService {
  private eventSource: EventSource | null = null;
  private subject: Subject<GenericSubmission> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3_000;   // Start at 3 s
  private readonly maxDelay = 30_000; // Cap at 30 s
  private token = '';
  private readonly zone: NgZone;

  constructor(zone: NgZone) {
    this.zone = zone;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Open the SSE stream. Returns an Observable that emits each new submission. */
  connect(token: string): Observable<GenericSubmission> {
    if (this.subject) return this.subject.asObservable(); // Already connected

    this.token = token;
    this.subject = new Subject<GenericSubmission>();
    this.reconnectDelay = 3_000;
    this.openStream();

    return this.subject.asObservable();
  }

  /** Close the SSE stream and clean up. */
  disconnect(): void {
    this.cleanup();
    if (this.subject) {
      this.subject.complete();
      this.subject = null;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private openStream(): void {
    if (!this.token || !this.subject) return;

    const url = `/api/events/submissions?token=${encodeURIComponent(this.token)}`;
    this.eventSource = new EventSource(url);

    // Typed submission event pushed by the server
    this.eventSource.addEventListener('submission', (evt: MessageEvent) => {
      this.zone.run(() => {
        try {
          const data = JSON.parse(evt.data) as GenericSubmission;
          this.subject?.next(data);
        } catch {
          console.warn('[SSE] Failed to parse submission event data');
        }
      });
    });

    // Successful connection confirmation
    this.eventSource.addEventListener('connected', () => {
      console.log('[SSE] Live results stream connected');
      this.reconnectDelay = 3_000; // Reset back-off on clean connect
    });

    // Browser auto-reconnects on error, but we add our own back-off on top
    this.eventSource.onerror = () => {
      console.warn(`[SSE] Connection error — reconnecting in ${this.reconnectDelay / 1000}s`);
      this.cleanup(/* keepSubject */ true);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.subject) return; // disconnect() was called — don't reconnect

    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.openStream();
    }, this.reconnectDelay);
  }

  private cleanup(keepSubject = false): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (!keepSubject && this.subject) {
      this.subject = null;
    }
  }
}
