/**
 * Storage supplied by the Orbis desktop application.
 *
 * Inside Orbis, investigations are kept in the active profile's own folder rather than in the browser's database,
 * so one profile never sees another's work. The document is read once when Orbis Chance opens and written back,
 * debounced, after each change and again as the page is hidden. A write that fails is reported on the next read of
 * `saveError`, and is never presented as saved.
 */
import { DEFAULT_PREFERENCES, investigationSchema, preferencesSchema, templateSchema } from './schema';
import { MemoryStore, type RecentEntry } from './store';

interface HostBridge {
  chanceStore(op: 'load' | 'save', document?: unknown): Promise<unknown>;
}

const bridge = (): HostBridge | null => {
  const api = (globalThis as unknown as { api?: Partial<HostBridge> }).api;
  return api && typeof api.chanceStore === 'function' ? (api as HostBridge) : null;
};

interface HostDocument {
  version: 1;
  investigations: unknown[];
  templates: unknown[];
  preferences: unknown;
  recent: RecentEntry[];
}

export class HostStore extends MemoryStore {
  override readonly kind = 'indexeddb' as const;
  saveError: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly host: HostBridge) {
    super();
    if (typeof addEventListener === 'function') {
      addEventListener('pagehide', () => void this.flush());
      addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  async load(): Promise<void> {
    const raw = (await this.host.chanceStore('load')) as Partial<HostDocument> | null;
    if (!raw || typeof raw !== 'object') return;
    for (const row of Array.isArray(raw.investigations) ? raw.investigations : []) {
      const parsed = investigationSchema.safeParse(row);
      if (parsed.success) this.investigations.set(parsed.data.id, parsed.data);
    }
    for (const row of Array.isArray(raw.templates) ? raw.templates : []) {
      const parsed = templateSchema.safeParse(row);
      if (parsed.success) this.templates.set(parsed.data.id, parsed.data);
    }
    const prefs = preferencesSchema.safeParse(raw.preferences ?? {});
    this.prefs = prefs.success ? prefs.data : DEFAULT_PREFERENCES;
    this.recent = Array.isArray(raw.recent)
      ? raw.recent.filter((r): r is RecentEntry => !!r && typeof r.investigationId === 'string' && typeof r.openedAt === 'string')
      : [];
  }

  protected override changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), 300);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const document: HostDocument = {
      version: 1,
      investigations: [...this.investigations.values()],
      templates: [...this.templates.values()],
      preferences: this.prefs,
      recent: this.recent,
    };
    this.writing = this.writing.then(async () => {
      try {
        await this.host.chanceStore('save', document);
        this.saveError = null;
      } catch (e) {
        this.saveError = e instanceof Error ? e.message : 'The save did not complete.';
      }
    });
    await this.writing;
  }
}

/** Returns the host-backed store when running inside Orbis, otherwise null. */
export async function openHostStore(): Promise<HostStore | null> {
  const host = bridge();
  if (!host) return null;
  const store = new HostStore(host);
  await store.load();
  return store;
}
