import { Injectable } from '@angular/core';
import { GenericSubmission, SurveyTemplate } from '../models/survey.model';

@Injectable({
  providedIn: 'root'
})
export class IndexedDbService {
  private readonly dbName = 'SurveyOfflineDB';
  private readonly dbVersion = 3; // Incremented to version 3 to support permanent history archives
  private readonly submissionsStore = 'pending_submissions';
  private readonly templatesStore = 'survey_templates';
  private readonly historyStore = 'completed_history';
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      this.dbPromise = this.initDb();
    }
  }

  private initDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        // Create pending submissions queue store
        if (!db.objectStoreNames.contains(this.submissionsStore)) {
          db.createObjectStore(this.submissionsStore, { keyPath: 'id', autoIncrement: true });
        }
        // Create dynamic survey templates designs store
        if (!db.objectStoreNames.contains(this.templatesStore)) {
          db.createObjectStore(this.templatesStore, { keyPath: 'id' });
        }
        // Create permanent completed survey submissions history store
        if (!db.objectStoreNames.contains(this.historyStore)) {
          db.createObjectStore(this.historyStore, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (event: any) => {
        resolve(event.target.result);
      };

      request.onerror = (event: any) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      throw new Error('IndexedDB is not supported or not initialized in this environment.');
    }
    return this.dbPromise;
  }

  // --- Submissions Methods (Offline Queue) ---
  async addSubmission(submission: GenericSubmission): Promise<number> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.submissionsStore], 'readwrite');
      const store = transaction.objectStore(this.submissionsStore);
      const record = { ...submission };
      delete record.id; // auto-increment handles it

      const request = store.add(record);

      request.onsuccess = (event: any) => {
        resolve(event.target.result as number);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async getAllSubmissions(): Promise<GenericSubmission[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.submissionsStore], 'readonly');
      const store = transaction.objectStore(this.submissionsStore);
      const request = store.getAll();

      request.onsuccess = (event: any) => {
        resolve(event.target.result as GenericSubmission[]);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async deleteSubmission(id: number): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.submissionsStore], 'readwrite');
      const store = transaction.objectStore(this.submissionsStore);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async getCount(): Promise<number> {
    if (!this.dbPromise) return 0;
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.submissionsStore], 'readonly');
      const store = transaction.objectStore(this.submissionsStore);
      const request = store.count();

      request.onsuccess = (event: any) => {
        resolve(event.target.result as number);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  // --- Survey Templates Methods (Admin Designs) ---
  async saveTemplate(template: SurveyTemplate): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.templatesStore], 'readwrite');
      const store = transaction.objectStore(this.templatesStore);
      const request = store.put(template); // put updates if exists, inserts otherwise

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async getAllTemplates(): Promise<SurveyTemplate[]> {
    if (!this.dbPromise) return [];
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.templatesStore], 'readonly');
      const store = transaction.objectStore(this.templatesStore);
      const request = store.getAll();

      request.onsuccess = (event: any) => {
        resolve(event.target.result as SurveyTemplate[]);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.templatesStore], 'readwrite');
      const store = transaction.objectStore(this.templatesStore);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  // --- Historical Archive Methods (Permanent Log) ---
  async addHistorySubmission(submission: GenericSubmission): Promise<number> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.historyStore], 'readwrite');
      const store = transaction.objectStore(this.historyStore);
      const record = { ...submission };
      delete record.id; // auto-increment handles it

      const request = store.add(record);

      request.onsuccess = (event: any) => {
        resolve(event.target.result as number);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async getAllHistorySubmissions(): Promise<GenericSubmission[]> {
    if (!this.dbPromise) return [];
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.historyStore], 'readonly');
      const store = transaction.objectStore(this.historyStore);
      const request = store.getAll();

      request.onsuccess = (event: any) => {
        // Reverse so that newest submissions show first
        const results = (event.target.result as GenericSubmission[]).reverse();
        resolve(results);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async deleteHistorySubmission(id: number): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.historyStore], 'readwrite');
      const store = transaction.objectStore(this.historyStore);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async clearHistorySubmissions(): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.historyStore], 'readwrite');
      const store = transaction.objectStore(this.historyStore);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async updateHistoryStatusByUuid(uuid: string, status: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.historyStore], 'readwrite');
      const store = transaction.objectStore(this.historyStore);
      const request = store.openCursor();

      request.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.uuid === uuid) {
            const updated = { ...cursor.value, status };
            const updateRequest = cursor.update(updated);
            updateRequest.onsuccess = () => {
              resolve();
            };
            updateRequest.onerror = (errEvent: any) => {
              reject(errEvent.target.error);
            };
            return;
          }
          cursor.continue();
        } else {
          resolve(); // Resolve if cursor finishes and we didn't find a match
        }
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }
}
