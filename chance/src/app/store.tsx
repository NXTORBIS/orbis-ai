/**
 * Application state: persistence access, preferences, routing and the
 * investigation currently being edited.
 *
 * The store owns no mathematics. Tools read and write their own configuration
 * through `updateConfig` and run calculations through the engine directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_PREFERENCES,
  investigationSchema,
  parseExportFile,
  type Investigation,
  type Preferences,
  type ResultSummary,
  type ToolId,
  type UserTemplate,
} from '../persistence/schema';
import { exportInvestigations, newId, openStore, type Store } from '../persistence/store';
import { hashToRoute, routeToHash, type Route } from './tools';
import { useToast } from '../ui/primitives';

export interface AppState {
  store: Store | null;
  storageWarning: string | null;
  ready: boolean;
  preferences: Preferences;
  setPreferences(next: Partial<Preferences>): void;
  route: Route;
  navigate(route: Route): void;
  investigations: Investigation[];
  templates: UserTemplate[];
  recentIds: string[];
  /** The investigation open in the current tool, if any. */
  current: Investigation | null;
  /** True when the current investigation has unsaved changes. */
  dirty: boolean;
  openInvestigation(id: string): Promise<void>;
  /** Restore this tool's working investigation; false when it has none yet. */
  resumeTool(toolId: ToolId): boolean;
  startInvestigation(toolId: ToolId, config: unknown, options?: { name?: string; simulation?: Investigation['simulation']; origin?: Investigation['origin']; assumptions?: string[] }): void;
  updateConfig(config: unknown): void;
  updateCurrent(patch: Partial<Investigation>): void;
  saveCurrent(): Promise<void>;
  setResultSummary(summary: ResultSummary | undefined): void;
  renameInvestigation(id: string, name: string): Promise<void>;
  duplicateInvestigation(id: string): Promise<void>;
  deleteInvestigation(id: string): Promise<void>;
  saveAsTemplate(name: string, category: string): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  exportAll(): void;
  exportOne(id: string): void;
  importFile(text: string): Promise<{ added: number; renamed: number; warnings: string[] }>;
  refresh(): Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [store, setStore] = useState<Store | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preferences, setPrefsState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<Investigation | null>(null);
  const [dirty, setDirty] = useState(false);
  /**
   * The working investigation for each tool, kept for the session.
   *
   * Without this, leaving a tool and coming back started a fresh investigation
   * with a new id: unsaved edits were lost silently, and saving again inserted
   * a second record instead of updating the first.
   */
  const draftsRef = useRef<Map<ToolId, Investigation>>(new Map());
  const dirtyToolsRef = useRef<Set<ToolId>>(new Set());
  const [route, setRoute] = useState<Route>(() => hashToRoute(typeof location !== 'undefined' ? location.hash : ''));

  // Open the store once at start-up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { store: s, warning } = await openStore();
      if (cancelled) return;
      setStore(s);
      setStorageWarning(warning);
      try {
        const [prefs, list, tpl, recent] = await Promise.all([s.getPreferences(), s.listInvestigations(), s.listTemplates(), s.listRecent(10)]);
        setPrefsState(prefs);
        setInvestigations(list);
        setTemplates(tpl);
        setRecentIds(recent.map((r) => r.investigationId));
      } catch {
        setStorageWarning((w) => w ?? 'Saved data could not be read. The application is usable, but previous investigations may not appear.');
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme and motion preferences to the document.
  useEffect(() => {
    const root = document.documentElement;
    const resolve = () => {
      if (preferences.theme === 'system') {
        const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
        root.dataset.theme = dark ? 'dark' : 'light';
      } else {
        root.dataset.theme = preferences.theme;
      }
    };
    resolve();
    root.dataset.reducedMotion = String(preferences.reducedMotion);
    if (preferences.theme !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', resolve);
    return () => mq?.removeEventListener('change', resolve);
  }, [preferences.theme, preferences.reducedMotion]);

  // Hash-based routing.
  useEffect(() => {
    const onHashChange = () => setRoute(hashToRoute(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (location.hash !== hash) location.hash = hash;
    else setRoute(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!store) return;
    const [list, tpl, recent] = await Promise.all([store.listInvestigations(), store.listTemplates(), store.listRecent(10)]);
    setInvestigations(list);
    setTemplates(tpl);
    setRecentIds(recent.map((r) => r.investigationId));
  }, [store]);

  const setPreferences = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefsState((prev) => {
        const next = { ...prev, ...patch };
        void store?.savePreferences(next).catch(() => toast.push('error', 'Preferences could not be saved to local storage.'));
        return next;
      });
    },
    [store, toast],
  );

  const startInvestigation = useCallback<AppState['startInvestigation']>((toolId, config, options) => {
    const now = new Date().toISOString();
    const investigation: Investigation = {
      id: newId(),
      name: options?.name ?? 'Untitled investigation',
      description: '',
      toolId,
      config,
      simulation: options?.simulation,
      assumptions: options?.assumptions ?? [],
      tags: [],
      createdAt: now,
      updatedAt: now,
      origin: options?.origin ?? { kind: 'blank' },
    };
    draftsRef.current.set(toolId, investigation);
    dirtyToolsRef.current.delete(toolId);
    setCurrent(investigation);
    setDirty(false);
  }, []);

  /**
   * Restore this tool's working investigation, or report that there is none so
   * the caller can start one. Never replaces an existing draft.
   */
  const resumeTool = useCallback((toolId: ToolId): boolean => {
    const draft = draftsRef.current.get(toolId);
    if (!draft) return false;
    setCurrent(draft);
    setDirty(dirtyToolsRef.current.has(toolId));
    return true;
  }, []);

  const openInvestigation = useCallback(
    async (id: string) => {
      if (!store) return;
      // Reading the record is asynchronous, and the person may well have moved
      // on while it was in flight. Without this check the open completes late,
      // replaces the screen they are now looking at and drags the address back
      // to the old one — losing whatever they had on the new screen.
      const hashWhenAsked = typeof location === 'undefined' ? '' : location.hash;
      const stillWanted = () => typeof location === 'undefined' || location.hash === hashWhenAsked;
      const found = await store.getInvestigation(id);
      if (!stillWanted()) return;
      if (!found) {
        toast.push('error', 'That investigation could not be found. It may have been deleted.');
        return;
      }
      draftsRef.current.set(found.toolId, found);
      dirtyToolsRef.current.delete(found.toolId);
      setCurrent(found);
      setDirty(false);
      await store.recordRecent(id);
      setRecentIds((prev) => [id, ...prev.filter((r) => r !== id)].slice(0, 10));
      if (stillWanted()) navigate({ kind: 'tool', toolId: found.toolId, investigationId: id });
    },
    [store, toast, navigate],
  );

  /** Apply a change to the open investigation and remember it for its tool. */
  const applyToCurrent = useCallback((patch: Partial<Investigation>, markDirty: boolean) => {
    setCurrent((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      draftsRef.current.set(next.toolId, next);
      if (markDirty) dirtyToolsRef.current.add(next.toolId);
      return next;
    });
    if (markDirty) setDirty(true);
  }, []);

  const updateConfig = useCallback((config: unknown) => applyToCurrent({ config }, true), [applyToCurrent]);

  const updateCurrent = useCallback((patch: Partial<Investigation>) => applyToCurrent(patch, true), [applyToCurrent]);

  /** Result summaries are not user edits, so they do not mark the document dirty. */
  const setResultSummary = useCallback(
    (summary: ResultSummary | undefined) => applyToCurrent({ resultSummary: summary }, false),
    [applyToCurrent],
  );

  const saveCurrent = useCallback(async () => {
    if (!store || !current) return;
    const next: Investigation = { ...current, updatedAt: new Date().toISOString() };
    const parsed = investigationSchema.safeParse(next);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.push('error', `This investigation cannot be saved: ${issue.path.join('.')} — ${issue.message}`);
      return;
    }
    try {
      await store.saveInvestigation(parsed.data);
      await store.recordRecent(parsed.data.id);
      draftsRef.current.set(parsed.data.toolId, parsed.data);
      dirtyToolsRef.current.delete(parsed.data.toolId);
      setCurrent(parsed.data);
      setDirty(false);
      // Put the id in the route so a reload or a shared link reopens this
      // record rather than starting a new one.
      const hash = routeToHash({ kind: 'tool', toolId: parsed.data.toolId, investigationId: parsed.data.id });
      if (location.hash !== hash) location.hash = hash;
      await refresh();
      toast.push('success', store.kind === 'memory' ? `"${parsed.data.name}" saved for this session only — local storage is unavailable, so export it to keep a copy.` : `"${parsed.data.name}" saved.`);
    } catch (e) {
      toast.push('error', `Saving failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [store, current, toast, refresh]);

  const renameInvestigation = useCallback(
    async (id: string, name: string) => {
      if (!store) return;
      const found = await store.getInvestigation(id);
      if (!found) return;
      const next = { ...found, name, updatedAt: new Date().toISOString() };
      await store.saveInvestigation(next);
      if (current?.id === id) setCurrent(next);
      await refresh();
      toast.push('success', `Renamed to "${name}".`);
    },
    [store, current, refresh, toast],
  );

  const duplicateInvestigation = useCallback(
    async (id: string) => {
      if (!store) return;
      const found = await store.getInvestigation(id);
      if (!found) {
        // A new investigation lives only in this session until it is saved, so
        // there is nothing on disk to copy. Saying so is better than a button
        // that appears to do nothing.
        toast.push('error', 'There is nothing to duplicate yet: save this investigation first, then duplicate the saved copy.');
        return;
      }
      const now = new Date().toISOString();
      const copy: Investigation = {
        ...found,
        id: newId(),
        name: nextCopyName(found.name, investigations.map((i) => i.name)),
        createdAt: now,
        updatedAt: now,
        origin: { kind: 'duplicate', ref: found.id },
      };
      await store.saveInvestigation(copy);
      await refresh();
      toast.push('success', `Duplicated as "${copy.name}".`);
      await openInvestigation(copy.id);
    },
    [store, investigations, refresh, toast, openInvestigation],
  );

  const deleteInvestigation = useCallback(
    async (id: string) => {
      if (!store) return;
      const found = investigations.find((i) => i.id === id);
      await store.deleteInvestigation(id);
      if (current?.id === id) {
        draftsRef.current.delete(current.toolId);
        dirtyToolsRef.current.delete(current.toolId);
        setCurrent(null);
        setDirty(false);
      }
      await refresh();
      toast.push('success', `"${found?.name ?? 'Investigation'}" deleted.`);
    },
    [store, investigations, current, refresh, toast],
  );

  const saveAsTemplate = useCallback(
    async (name: string, category: string) => {
      if (!store || !current) return;
      const template: UserTemplate = {
        id: newId(),
        name,
        description: current.description,
        toolId: current.toolId,
        config: current.config,
        simulation: current.simulation,
        category: category || 'Custom',
        createdAt: new Date().toISOString(),
        builtIn: false,
      };
      await store.saveTemplate(template);
      await refresh();
      toast.push('success', `Saved "${name}" as a reusable template.`);
    },
    [store, current, refresh, toast],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      if (!store) return;
      await store.deleteTemplate(id);
      await refresh();
      toast.push('success', 'Template deleted.');
    },
    [store, refresh, toast],
  );

  const exportAll = useCallback(() => {
    if (!investigations.length) {
      toast.push('info', 'There are no saved investigations to export yet.');
      return;
    }
    exportInvestigations(investigations, templates);
  }, [investigations, templates, toast]);

  const exportOne = useCallback(
    (id: string) => {
      const found = investigations.find((i) => i.id === id) ?? (current?.id === id ? current : null);
      if (!found) return;
      exportInvestigations([found]);
    },
    [investigations, current],
  );

  /**
   * Import never overwrites an existing investigation: an incoming id that
   * already exists is given a fresh id and a distinguishable name.
   */
  const importFile = useCallback<AppState['importFile']>(
    async (text) => {
      if (!store) throw new Error('Storage is not ready.');
      const outcome = parseExportFile(text);
      const existingIds = new Set(investigations.map((i) => i.id));
      const existingNames = investigations.map((i) => i.name);
      let renamed = 0;
      const now = new Date().toISOString();
      const toAdd = outcome.investigations.map((inv) => {
        if (!existingIds.has(inv.id)) return { ...inv, origin: inv.origin ?? { kind: 'import' as const } };
        renamed++;
        const name = nextCopyName(inv.name, existingNames, 'imported');
        existingNames.push(name);
        return { ...inv, id: newId(), name, updatedAt: now, origin: { kind: 'import' as const, ref: inv.id } };
      });
      await store.saveMany(toAdd);
      for (const t of outcome.templates) await store.saveTemplate(t);
      await refresh();
      return { added: toAdd.length, renamed, warnings: outcome.warnings };
    },
    [store, investigations, refresh],
  );

  const value = useMemo<AppState>(
    () => ({
      store,
      storageWarning,
      ready,
      preferences,
      setPreferences,
      route,
      navigate,
      investigations,
      templates,
      recentIds,
      current,
      dirty,
      openInvestigation,
      resumeTool,
      startInvestigation,
      updateConfig,
      updateCurrent,
      saveCurrent,
      setResultSummary,
      renameInvestigation,
      duplicateInvestigation,
      deleteInvestigation,
      saveAsTemplate,
      deleteTemplate,
      exportAll,
      exportOne,
      importFile,
      refresh,
    }),
    [
      store,
      storageWarning,
      ready,
      preferences,
      setPreferences,
      route,
      navigate,
      investigations,
      templates,
      recentIds,
      current,
      dirty,
      openInvestigation,
      resumeTool,
      startInvestigation,
      updateConfig,
      updateCurrent,
      saveCurrent,
      setResultSummary,
      renameInvestigation,
      duplicateInvestigation,
      deleteInvestigation,
      saveAsTemplate,
      deleteTemplate,
      exportAll,
      exportOne,
      importFile,
      refresh,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider.');
  return ctx;
}

/** "Name (copy)", then "(copy 2)", so duplicates never collide silently. */
export function nextCopyName(base: string, existing: string[], word = 'copy'): string {
  const stripped = base.replace(new RegExp(`\\s*\\(${word}(?: \\d+)?\\)$`), '');
  // The stored name has a maximum length. Trim the base so the suffix fits,
  // otherwise a long name makes the whole save or import fail validation.
  const fit = (suffix: string) => {
    const room = MAX_NAME_LENGTH - suffix.length;
    return `${stripped.length > room ? `${stripped.slice(0, Math.max(0, room - 1))}…` : stripped}${suffix}`;
  };
  let candidate = fit(` (${word})`);
  let n = 2;
  while (existing.includes(candidate)) {
    candidate = fit(` (${word} ${n})`);
    n++;
  }
  return candidate;
}

/** Matches the `name` limit in the persisted schema. */
const MAX_NAME_LENGTH = 200;
