/**
 * Local persistence using IndexedDB.
 *
 * All data stays in the browser. Nothing is sent to a server: there is no
 * network code in this module. IndexedDB is used rather than localStorage
 * because investigations can hold sizeable configurations (datasets, matrices)
 * and because it supports transactions and indexes.
 *
 * A `StorageUnavailableError` is raised when IndexedDB cannot be used (private
 * browsing restrictions, blocked site data). The application surfaces that
 * honestly instead of pretending a save succeeded, and falls back to an
 * in-memory store for the session so the tools still work.
 */
import {
  DEFAULT_PREFERENCES,
  buildExportFile,
  investigationSchema,
  preferencesSchema,
  templateSchema,
  type Investigation,
  type Preferences,
  type UserTemplate,
} from './schema';

export const DB_NAME = 'orbis-chance';
export const DB_VERSION = 1;
const STORE_INVESTIGATIONS = 'investigations';
const STORE_TEMPLATES = 'templates';
const STORE_PREFERENCES = 'preferences';
const STORE_RECENT = 'recent';

export class StorageUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export interface RecentEntry {
  investigationId: string;
  openedAt: string;
}

export interface Store {
  readonly kind: 'indexeddb' | 'memory';
  listInvestigations(): Promise<Investigation[]>;
  getInvestigation(id: string): Promise<Investigation | null>;
  saveInvestigation(investigation: Investigation): Promise<void>;
  deleteInvestigation(id: string): Promise<void>;
  /** Save several in one transaction; nothing is written if any one fails. */
  saveMany(investigations: Investigation[]): Promise<void>;
  listTemplates(): Promise<UserTemplate[]>;
  saveTemplate(template: UserTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  getPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<void>;
  recordRecent(investigationId: string): Promise<void>;
  listRecent(limit?: number): Promise<RecentEntry[]>;
  clearAll(): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageUnavailableError('This browser does not provide IndexedDB, so investigations cannot be saved.'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new StorageUnavailableError('IndexedDB could not be opened. Saving is unavailable in this browsing mode.', e));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_INVESTIGATIONS)) {
        const s = db.createObjectStore(STORE_INVESTIGATIONS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('toolId', 'toolId');
      }
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_PREFERENCES)) db.createObjectStore(STORE_PREFERENCES);
      if (!db.objectStoreNames.contains(STORE_RECENT)) {
        const s = db.createObjectStore(STORE_RECENT, { keyPath: 'investigationId' });
        s.createIndex('openedAt', 'openedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageUnavailableError('IndexedDB refused to open. Site data may be blocked for this page.', request.error));
    request.onblocked = () => reject(new StorageUnavailableError('Another tab is holding an older version of the database open. Close other Orbis Chance tabs and reload.'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The storage request failed.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('The storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('The storage transaction was aborted. Nothing was saved.'));
  });
}

class IndexedDbStore implements Store {
  readonly kind = 'indexeddb' as const;
  constructor(private readonly db: IDBDatabase) {}

  async listInvestigations(): Promise<Investigation[]> {
    const tx = this.db.transaction(STORE_INVESTIGATIONS, 'readonly');
    const all = await promisify(tx.objectStore(STORE_INVESTIGATIONS).getAll());
    // Rows written by an older version could fail validation; keep the valid ones
    // and report nothing silently by filtering with a logged count.
    const valid: Investigation[] = [];
    for (const row of all) {
      const parsed = investigationSchema.safeParse(row);
      if (parsed.success) valid.push(parsed.data);
    }
    return valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getInvestigation(id: string): Promise<Investigation | null> {
    const tx = this.db.transaction(STORE_INVESTIGATIONS, 'readonly');
    const row = await promisify(tx.objectStore(STORE_INVESTIGATIONS).get(id));
    if (!row) return null;
    const parsed = investigationSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  async saveInvestigation(investigation: Investigation): Promise<void> {
    const value = investigationSchema.parse(investigation);
    const tx = this.db.transaction(STORE_INVESTIGATIONS, 'readwrite');
    tx.objectStore(STORE_INVESTIGATIONS).put(value);
    await transactionDone(tx);
  }

  async saveMany(investigations: Investigation[]): Promise<void> {
    const values = investigations.map((i) => investigationSchema.parse(i));
    const tx = this.db.transaction(STORE_INVESTIGATIONS, 'readwrite');
    const store = tx.objectStore(STORE_INVESTIGATIONS);
    for (const v of values) store.put(v);
    await transactionDone(tx);
  }

  async deleteInvestigation(id: string): Promise<void> {
    const tx = this.db.transaction([STORE_INVESTIGATIONS, STORE_RECENT], 'readwrite');
    tx.objectStore(STORE_INVESTIGATIONS).delete(id);
    tx.objectStore(STORE_RECENT).delete(id);
    await transactionDone(tx);
  }

  async listTemplates(): Promise<UserTemplate[]> {
    const tx = this.db.transaction(STORE_TEMPLATES, 'readonly');
    const all = await promisify(tx.objectStore(STORE_TEMPLATES).getAll());
    return all.map((r) => templateSchema.safeParse(r)).filter((r) => r.success).map((r) => r.data!);
  }

  async saveTemplate(template: UserTemplate): Promise<void> {
    const value = templateSchema.parse(template);
    const tx = this.db.transaction(STORE_TEMPLATES, 'readwrite');
    tx.objectStore(STORE_TEMPLATES).put(value);
    await transactionDone(tx);
  }

  async deleteTemplate(id: string): Promise<void> {
    const tx = this.db.transaction(STORE_TEMPLATES, 'readwrite');
    tx.objectStore(STORE_TEMPLATES).delete(id);
    await transactionDone(tx);
  }

  async getPreferences(): Promise<Preferences> {
    const tx = this.db.transaction(STORE_PREFERENCES, 'readonly');
    const row = await promisify(tx.objectStore(STORE_PREFERENCES).get('preferences'));
    const parsed = preferencesSchema.safeParse(row ?? {});
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  }

  async savePreferences(prefs: Preferences): Promise<void> {
    const value = preferencesSchema.parse(prefs);
    const tx = this.db.transaction(STORE_PREFERENCES, 'readwrite');
    tx.objectStore(STORE_PREFERENCES).put(value, 'preferences');
    await transactionDone(tx);
  }

  async recordRecent(investigationId: string): Promise<void> {
    const tx = this.db.transaction(STORE_RECENT, 'readwrite');
    tx.objectStore(STORE_RECENT).put({ investigationId, openedAt: new Date().toISOString() });
    await transactionDone(tx);
  }

  async listRecent(limit = 8): Promise<RecentEntry[]> {
    const tx = this.db.transaction(STORE_RECENT, 'readonly');
    const all = (await promisify(tx.objectStore(STORE_RECENT).getAll())) as RecentEntry[];
    return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, limit);
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction([STORE_INVESTIGATIONS, STORE_TEMPLATES, STORE_RECENT], 'readwrite');
    tx.objectStore(STORE_INVESTIGATIONS).clear();
    tx.objectStore(STORE_TEMPLATES).clear();
    tx.objectStore(STORE_RECENT).clear();
    await transactionDone(tx);
  }
}

/** In-memory fallback used when IndexedDB is unavailable. Data is lost on reload. */
export class MemoryStore implements Store {
  readonly kind: 'indexeddb' | 'memory' = 'memory';
  /** Called after every change; the host-backed store writes through here. */
  protected changed(): void {}

  protected investigations = new Map<string, Investigation>();
  protected templates = new Map<string, UserTemplate>();
  protected prefs: Preferences = DEFAULT_PREFERENCES;
  protected recent: RecentEntry[] = [];

  async listInvestigations() {
    return [...this.investigations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getInvestigation(id: string) {
    return this.investigations.get(id) ?? null;
  }
  async saveInvestigation(i: Investigation) {
    this.investigations.set(i.id, investigationSchema.parse(i));
    this.changed();
  }
  async saveMany(list: Investigation[]) {
    const parsed = list.map((i) => investigationSchema.parse(i));
    for (const i of parsed) this.investigations.set(i.id, i);
    this.changed();
  }
  async deleteInvestigation(id: string) {
    this.investigations.delete(id);
    this.recent = this.recent.filter((r) => r.investigationId !== id);
    this.changed();
  }
  async listTemplates() {
    return [...this.templates.values()];
  }
  async saveTemplate(t: UserTemplate) {
    this.templates.set(t.id, templateSchema.parse(t));
    this.changed();
  }
  async deleteTemplate(id: string) {
    this.templates.delete(id);
    this.changed();
  }
  async getPreferences() {
    return this.prefs;
  }
  async savePreferences(p: Preferences) {
    this.prefs = preferencesSchema.parse(p);
    this.changed();
  }
  async recordRecent(investigationId: string) {
    this.recent = [{ investigationId, openedAt: new Date().toISOString() }, ...this.recent.filter((r) => r.investigationId !== investigationId)];
    this.changed();
  }
  async listRecent(limit = 8) {
    return this.recent.slice(0, limit);
  }
  async clearAll() {
    this.investigations.clear();
    this.templates.clear();
    this.recent = [];
    this.changed();
  }
}

export interface OpenStoreResult {
  store: Store;
  /** Set when persistent storage was unavailable and the memory store is in use. */
  warning: string | null;
}

export async function openStore(): Promise<OpenStoreResult> {
  // Inside Orbis, work is kept in the active profile's own folder. Loaded on demand: it extends MemoryStore.
  const { openHostStore } = await import('./hostStore');
  const host = await openHostStore();
  if (host) return { store: host, warning: null };
  try {
    const db = await openDatabase();
    return { store: new IndexedDbStore(db), warning: null };
  } catch (e) {
    const message =
      e instanceof StorageUnavailableError
        ? e.message
        : 'Local storage could not be opened for an unexpected reason.';
    return {
      store: new MemoryStore(),
      warning: `${message} Your work will stay available while this tab is open, but it will not be saved when you leave. Use Export to keep a copy as a file.`,
    };
  }
}

/** Download helper for exports. Creates a Blob; no network request is made. */
export function downloadJson(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  triggerDownload(filename, blob);
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  triggerDownload(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportInvestigations(investigations: Investigation[], templates: UserTemplate[] = []): void {
  const name =
    investigations.length === 1
      ? `${slug(investigations[0].name)}.orbis-chance.json`
      : `orbis-chance-export-${new Date().toISOString().slice(0, 10)}.json`;
  downloadJson(name, buildExportFile(investigations, templates));
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'investigation'
  );
}

/** RFC 4180 CSV serialisation of a table. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

/** Short random id suitable for document keys (not security-sensitive). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
