import { Component, inject } from '@angular/core';
import { SurveySyncStore } from '../../store/survey-sync.store';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [],
  template: `
    <header class="status-bar">
      <div class="brand">
        <span class="logo">✦</span>
        <h1 class="title">Survayo <span class="badge">PWA</span></h1>
      </div>

      <div class="network-badge-container">
        @if (store.isOnline()) {
          <div class="status-indicator online">
            <span class="pulse-dot"></span>
            <span class="status-text">Live Cloud Sync</span>
          </div>
        } @else {
          <div class="status-indicator offline">
            <span class="static-dot"></span>
            <span class="status-text">Offline Local Cache</span>
          </div>
        }

        @if (store.pendingSyncCount() > 0) {
          <div class="sync-count-badge">
            {{ store.pendingSyncCount() }} Pending Sync
          </div>
        }

        @if (store.syncing()) {
          <div class="syncing-loader">
            <span class="spinner"></span>
            <span>Syncing...</span>
          </div>
        }
      </div>

      <div class="actions">
        @if (store.isOnline() && store.pendingSyncCount() > 0) {
          <button 
            class="btn btn-sync" 
            [disabled]="store.syncing()"
            (click)="store.syncPendingSubmissions()"
          >
            Sync Now
          </button>
        }
      </div>
    </header>
  `,
  styles: `
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.85rem 1.5rem;
      background: rgba(26, 27, 38, 0.65);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      position: sticky;
      top: 0;
      z-index: 100;
      border-radius: 0 0 16px 16px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .logo {
      font-size: 1.4rem;
      background: linear-gradient(135deg, #a9b1d6, #7aa2f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 700;
      animation: spin-slow 15s linear infinite;
    }

    @keyframes spin-slow {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .title {
      font-size: 1.15rem;
      font-weight: 600;
      color: #c0caf5;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .badge {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.4rem;
      background: rgba(122, 162, 247, 0.15);
      color: #7aa2f7;
      border-radius: 6px;
      border: 1px solid rgba(122, 162, 247, 0.25);
    }

    .network-badge-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      border-radius: 99px;
      font-size: 0.825rem;
      font-weight: 500;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .status-indicator.online {
      background: rgba(16, 185, 129, 0.1);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .status-indicator.offline {
      background: rgba(245, 158, 11, 0.1);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      animation: pulse 1.6s infinite;
    }

    .static-dot {
      width: 8px;
      height: 8px;
      background-color: #f59e0b;
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(245, 158, 11, 0.5);
    }

    @keyframes pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 8px rgba(16, 185, 129, 0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
      }
    }

    .status-text {
      font-weight: 500;
    }

    .sync-count-badge {
      background: rgba(187, 154, 247, 0.12);
      color: #bb9af7;
      border: 1px solid rgba(187, 154, 247, 0.25);
      padding: 0.35rem 0.75rem;
      border-radius: 99px;
      font-size: 0.825rem;
      font-weight: 500;
    }

    .syncing-loader {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: #79dac8;
      font-size: 0.825rem;
      font-weight: 500;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(121, 218, 200, 0.2);
      border-top-color: #79dac8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .btn {
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.4rem 1rem;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-sync {
      background: linear-gradient(135deg, #7aa2f7, #565f89);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(122, 162, 247, 0.25);
    }

    .btn-sync:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(122, 162, 247, 0.4);
    }

    .btn-sync:active:not(:disabled) {
      transform: translateY(0);
    }

    .btn-sync:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `
})
export class StatusBarComponent {
  readonly store = inject(SurveySyncStore);
}
