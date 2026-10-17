import React, { useEffect, useMemo, useRef, useState } from 'react';
import { app, bootApp, closeDialog, confirm, toast } from './state/app';
import { useStore } from './state/store';
import { activeTab, navigate, activePane, followCustomization, paneCount, remapLocations, restoreSession, setPaneRatios, visiblePanes, ws, type Tab } from './state/workspace';
import type { OperationRecord } from '../shared/operations';
import { call, on } from './api';
import { aiState, describeCommands, handleGlobalKey } from './commands';
import { watchExisting } from './actions';
import { startRemote } from './state/remote';
import { followShares } from './state/shares';
import { TitleBar } from './features/Chrome';
import { HostPickBanner } from './features/HostPick';
import { PanelBoundary } from './ui/PanelBoundary';
import { Sidebar } from './features/Sidebar';
import { Pane } from './features/Pane';
import { Inspector } from './features/Inspector';
import { ConflictDialog, OperationsList, OperationsPanel } from './features/Operations';
import { CommandPalette, DialogHost, Toasts } from './features/Dialogs';
import { QuickSwitcher } from './features/QuickSwitcher';
import { followTemplatesSetting } from './state/templates';
import { followAutomation } from './state/automation';
import { followSchedules } from './state/backups';
import { Loading, Splitter, ErrorState, IconButton } from './ui/components';
import { Icon } from './ui/Icon';
import { applyCustom, bootCustomization, custom, reportRegistry, useCustom } from './state/custom';
import { fitState } from './state/layoutFit';
import { fitLayout } from '../shared/customization/layout';
import { ARRANGEMENT_GRID } from '../shared/customization/layout';
import { BackgroundLayer, useHasBackground } from './features/Background';
import { PreviewBar } from './features/studio/PreviewBar';
import { QuickLookOverlay } from './features/QuickLook';
import { openStudio } from './features/studio/studioState';
import type { HostRequest } from '../shared/integration/host-contract';
import type { Layout } from '../shared/customization/schema';
import { Shelf } from './features/Shelf';
import { ViewerHost } from './features/Preview';
import { EbookViewer } from './features/viewers/EbookViewer';
import { ComicViewer } from './features/viewers/ComicViewer';
import { ModelViewer } from './features/viewers/ModelViewer';
import { closeViewer } from './state/viewer';
import { loadShelf } from './state/shelf';
import { loadCustomActions } from './state/customActions';
import { installEditorGuards } from './state/editor';
import { startTerminal } from './state/terminal';
import { TerminalDock } from './features/TerminalDock';
import { PlayerBar } from './features/PlayerBar';
import { startPlayer } from './state/player';
import { startHostControl } from './state/hostControl';
import { ScreenshotAnnotator } from './features/ScreenshotAnnotator';

export function App() {
  const ready = useStore(app, (s) => s.ready);
  const customReady = useStore(custom, (s) => s.ready);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await bootCustomization();
        await bootApp();
        startRemote();
        followCustomization();
        followTemplatesSetting();
        installEditorGuards();
        startTerminal();
        void startPlayer();
        const params = new URLSearchParams(location.search);
        await restoreSession(params.has('reloaded') ? undefined : params.get('path') ?? window.orbis.initialPath);
        watchExisting();
        // Custom actions become commands (palette, menus, toolbar, shortcuts) once loaded.
        await loadCustomActions();
        void loadShelf();
        followShares();
        followAutomation();
        followSchedules();
        // The Files command registry (with metadata and effective bindings) for the shortcut adapter.
        reportRegistry(describeCommands());
        /*
         * Says what is on screen to the Orbis window, when there is one.
         *
         * Last, after the session has been restored and the commands exist, so the first thing the window is told is
         * a real screen rather than an empty one. Inert when Files is running on its own.
         */
        startHostControl();
        let lastBindings = custom.get().resolved.shortcuts;
        custom.subscribe(() => {
          if (custom.get().resolved.shortcuts !== lastBindings) {
            lastBindings = custom.get().resolved.shortcuts;
            reportRegistry(describeCommands());
          }
        });
        const st = await call<{ status: string; capabilities: string[] }>('ai:status');
        Object.assign(aiState, st);
      } catch (err) {
        setBootError((err as Error).message);
      }
    })();
    const offAi = on<{ status: string; capabilities: string[] }>('ai:status', (st) => {
      Object.assign(aiState, st);
      app.set({}); // re-evaluate command availability
    });
    const offHost = on<HostRequest | { type: 'request-failed'; request: string; message: string }>('host:request', (req) => void onHostRequest(req));
    // Keep tabs and history pointing at items Orbis Files renamed or moved.
    const remapped = new Set<string>();
    const offOps = on<OperationRecord>('ops:update', (rec) => {
      if (!rec?.results || remapped.has(rec.id) || !['completed', 'completed_with_errors'].includes(rec.state)) return;
      const organizedByMove = rec.type === 'organize-date' && rec.undo?.kind === 'transfer' && rec.undo.mode === 'move';
      if (rec.type !== 'move' && rec.type !== 'rename-batch' && !organizedByMove) return;
      remapped.add(rec.id);
      remapLocations(rec.results.filter((r) => r.status === 'done' && r.source && r.destination && r.source !== r.destination).map((r) => ({ from: r.source, to: r.destination! })));
    });
    const onKey = (e: KeyboardEvent) => void handleGlobalKey(e);
    window.addEventListener('keydown', onKey);
    const onStudio = (e: Event) => {
      const d = (e as CustomEvent<{ category?: string; setting?: string; paneId?: string }>).detail ?? {};
      openStudio(d.category, d.setting, d.paneId);
    };
    document.addEventListener('orbis:open-studio', onStudio);
    // Prevent the window from navigating when files are dropped outside a drop target.
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      offAi();
      offHost();
      offOps();
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('orbis:open-studio', onStudio);
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  if (bootError) return <div className="boot"><ErrorState title="Orbis Files could not start its interface" body={bootError} /></div>;
  if (!ready || !customReady) return <div className="boot"><Loading label="Starting Orbis Files…" /></div>;
  return <Shell />;
}

async function onHostRequest(req: HostRequest | { type: 'request-failed'; request: string; message: string }): Promise<void> {
  if (req.type === 'request-failed') toast({ level: 'error', title: 'A request from the Orbis app could not be completed', detail: req.message });
  else if (req.type === 'register-content-feed') toast({ level: 'info', title: `“${req.feed.label}” added to the library`, detail: 'Provided by the Orbis app.', actions: [{ label: 'Show', run: () => void navigate(activePane().id, { kind: 'library', category: `provider:${req.feed.providerId}` }) }] });
  else if (req.type === 'open-location' || req.type === 'reveal-file') void navigate(activePane().id, { kind: 'fs', path: req.path });
  else if (req.type === 'register-download') toast({ level: 'info', title: 'Download registered by Orbis', detail: req.download.path });
  else if (req.type === 'register-generated') toast({ level: 'info', title: 'AI-generated file registered', detail: req.item.path, actions: [{ label: 'Show', run: () => void navigate(activePane().id, { kind: 'library', category: 'generated' }) }] });
  else if (req.type === 'set-design-tokens') toast({ level: 'info', title: 'Colours from the Orbis app are in use', detail: 'Your own colour choices still apply on top. Status and focus colours stay under Orbis Files’ control.' });
  else if (req.type === 'clear-design-tokens') toast({ level: 'info', title: 'Back to the Orbis Files colours' });
  else if (req.type === 'open-settings') {
    const entry = req.entry;
    if (entry === 'files.settings') void navigate(activePane().id, { kind: 'tool', tool: 'settings' });
    else if (entry === 'files.integrations') void navigate(activePane().id, { kind: 'tool', tool: 'integrations' });
    else openStudio(entry.startsWith('files.customization.') ? entry.slice('files.customization.'.length) : 'overview');
  } else if (req.type === 'offer-ai-provider') {
    // A host can only offer a provider; the user decides, and the same endpoint rules apply as when typed in.
    const ok = await confirm({ title: `Use ${req.providerName} for Orbis AI?`, body: `The Orbis app offers an AI provider at ${req.endpoint}. Orbis Files connects only if you agree, and still asks before sharing any file or applying any change.`, confirmLabel: 'Use this provider' });
    if (!ok) return;
    try {
      const st = await call<{ status: string; capabilities: string[] }>('ai:configure', { endpoint: req.endpoint });
      Object.assign(aiState, st);
      app.set({});
      toast({ level: st.status === 'available' ? 'success' : 'warning', title: st.status === 'available' ? `${req.providerName} is connected` : `${req.providerName} did not respond as expected`, detail: st.status === 'available' ? undefined : 'See Integrations & diagnostics for the details.' });
    } catch (err) {
      toast({ level: 'error', title: 'The offered provider could not be used', detail: (err as Error).message });
    }
  }
}

function useWindowSize(): { w: number; h: number } {
  const [s, setS] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setS({ w: window.innerWidth, h: window.innerHeight }));
    };
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', on);
    };
  }, []);
  return s;
}

type Region = 'sidebar' | 'details';

/** Left and right panel order (outermost first on the left, last on the right). */
function sideRegions(l: Layout): { left: Region[]; right: Region[] } {
  const left: Region[] = [];
  const right: Region[] = [];
  if (l.sidebar.visible) (l.sidebar.side === 'left' ? left : right).push('sidebar');
  if (l.details.visible && l.details.position !== 'bottom') (l.details.position === 'left' ? left : right).push('details');
  const outerFirst = (xs: Region[]) => (xs.length === 2 ? (l.outermost === 'sidebar' ? ['sidebar', 'details'] : ['details', 'sidebar']) as Region[] : xs);
  return { left: outerFirst(left), right: outerFirst(right).reverse() };
}

function Shell() {
  const size = useWindowSize();
  const layout = useCustom((r) => r.layout);
  const tabArrangement = useStore(ws, (s) => ({ a: activeTab(s).arrangement, r: activeTab(s).ratios }));
  const narrowShow = useStore(app, (s) => s.narrowShow);
  const notices = useStore(app, (x) => x.notices);
  const opsOpen = useStore(app, (x) => x.opsPanelOpen);
  // Fit the layout (with this tab's panes) into the window; the saved layout is never changed.
  const fit = useMemo(() => fitLayout({ ...layout, panes: { arrangement: tabArrangement.a, ratios: tabArrangement.r } }, size.w, size.h), [layout, tabArrangement.a, tabArrangement.r, size.w, size.h]);
  const eff = useMemo(() => {
    const l = structuredClone(fit.layout);
    // Panels the user shows explicitly in a small window stay visible (narrowed to their minimum).
    if (narrowShow.sidebar && layout.sidebar.visible && !l.sidebar.visible) l.sidebar = { ...l.sidebar, visible: true, width: 180 };
    if (narrowShow.inspector && layout.details.visible && !l.details.visible) l.details = { ...l.details, visible: true, width: 260 };
    return l;
  }, [fit, narrowShow, layout]);
  useEffect(() => {
    fitState.set({ adjustments: fit.adjustments, hidden: { sidebar: layout.sidebar.visible && !fit.layout.sidebar.visible, details: layout.details.visible && !fit.layout.details.visible }, arrangement: fit.layout.panes.arrangement });
  }, [fit, layout]);

  const [noticesOpen, setNoticesOpen] = useState(true);
  const [noteDismissed, setNoteDismissed] = useState('');
  const noteKey = fit.adjustments.join('|');
  const { left, right } = sideRegions(eff);

  const sideWidth = (r: Region) => (r === 'sidebar' ? Math.min(eff.sidebar.width, Math.max(180, size.w * 0.4)) : Math.min(eff.details.width, Math.max(260, size.w * 0.45)));
  const renderSide = (r: Region, side: 'left' | 'right') => (
    <SidePanel key={r} region={r} side={side} width={sideWidth(r)} />
  );

  return (
    <div className="app">
      <Ambient />
      <TitleBar showTabs={eff.tabs.visible} />
      <HostPickBanner />
      {noticesOpen && notices.length > 0 && (
        <div className="notice-bar" role="status">
          <Icon name={notices.some((n) => n.level === 'error') ? 'error' : 'warning'} size={15} />
          <div className="notice-list">
            {notices.map((n, i) => <div key={i}><strong>{n.message}</strong>{n.detail && <span className="muted"> {n.detail}</span>}</div>)}
          </div>
          {notices.some((n) => /interrupted/.test(n.message)) && <button type="button" className="btn btn-default btn-sm" onClick={() => app.set({ opsPanelOpen: true })}>Review</button>}
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNoticesOpen(false)}><Icon name="close" size={13} /></button>
        </div>
      )}
      {fit.adjustments.length > 0 && noteDismissed !== noteKey && (
        <div className="layout-note" role="status">
          <Icon name="layout" size={14} />
          <span><strong>The window is smaller than your layout needs.</strong> {fit.adjustments.join(' ')} Your saved layout is unchanged.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openStudio('layout')}>Layout…</button>
          <IconButton icon="close" label="Dismiss" onClick={() => setNoteDismissed(noteKey)} />
        </div>
      )}
      <div className="main" data-layout-arrangement={eff.panes.arrangement}>
        {left.map((r) => renderSide(r, 'left'))}
        <div className="workspace-column">
          <Workspace layout={eff} />
          <PanelBoundary label="terminal"><TerminalDock /></PanelBoundary>
          <PanelBoundary label="music player"><PlayerBar /></PanelBoundary>
          {eff.shelf.visible && <PanelBoundary label="shelf"><Shelf /></PanelBoundary>}
          {eff.details.visible && eff.details.position === 'bottom' && <BottomDetails height={eff.details.height} />}
          {eff.operations.dock === 'bottom' && <OpsDock height={eff.operations.height} />}
        </div>
        {right.map((r) => renderSide(r, 'right'))}
      </div>
      {eff.operations.dock === 'overlay' && <OperationsPanel />}
      {eff.operations.dock === 'bottom' && opsOpen && <OpsDockFocus />}
      <ConflictDialog />
      <PanelBoundary label="dialog" onDismiss={closeDialog}><DialogHost /></PanelBoundary>
      <PanelBoundary label="viewer" onDismiss={closeViewer}><ViewerHost /></PanelBoundary>
      <EbookViewer />
      <ComicViewer />
      <ModelViewer />
      <CommandPalette />
      <QuickSwitcher />
      <PreviewBar />
      <ScreenshotAnnotator />
      <QuickLookOverlay />
      <Toasts />
    </div>
  );
}

/** A resizable side panel (sidebar or details). Resizing is one undoable layout change per drag. */
function SidePanel({ region, side, width }: { region: Region; side: 'left' | 'right'; width: number }) {
  const [w, setW] = useState(width);
  useEffect(() => setW(width), [width]);
  const isSidebar = region === 'sidebar';
  const min = isSidebar ? 180 : 260;
  const max = isSidebar ? 480 : 640;
  const splitter = (
    <Splitter side={side} label={isSidebar ? 'Resize sidebar' : 'Resize details panel'} value={Math.round(w)} min={min} max={max} onResize={(v, done) => {
      setW(v);
      if (done) void applyCustom({ op: 'set', section: 'layout', path: [isSidebar ? 'sidebar' : 'details', 'width'], value: Math.round(v), label: isSidebar ? 'Resized the sidebar' : 'Resized the details panel' }, { quiet: true });
    }} />
  );
  const content = isSidebar ? <PanelBoundary label="sidebar"><Sidebar /></PanelBoundary> : <PanelBoundary label="details panel"><Inspector /></PanelBoundary>;
  return isSidebar ? (
    <div className={`sidebar-wrap side-${side}`} role="region" aria-label="Sidebar" style={{ width: w }}>
      {side === 'right' && splitter}
      {content}
      {side === 'left' && splitter}
    </div>
  ) : (
    <aside className={`inspector-wrap side-${side}`} aria-label="Details" style={{ width: w }}>
      {side === 'right' && splitter}
      {content}
      {side === 'left' && splitter}
    </aside>
  );
}

function BottomDetails({ height }: { height: number }) {
  const [h, setH] = useState(height);
  useEffect(() => setH(height), [height]);
  return (
    <aside className="details-bottom" aria-label="Details" style={{ height: h }}>
      <Splitter orientation="horizontal" side="right" label="Resize details panel" value={Math.round(h)} min={160} max={600} onResize={(v, done) => {
        setH(v);
        if (done) void applyCustom({ op: 'set', section: 'layout', path: ['details', 'height'], value: Math.round(v), label: 'Resized the details panel' }, { quiet: true });
      }} />
      <PanelBoundary label="details panel"><Inspector /></PanelBoundary>
    </aside>
  );
}

/** Operations docked under the file area (Customization → Layout → Operations). */
function OpsDock({ height }: { height: number }) {
  const [h, setH] = useState(height);
  useEffect(() => setH(height), [height]);
  return (
    <section className="ops-dock" aria-label="Operations" style={{ height: h }} id="ops-dock" tabIndex={-1}>
      <Splitter orientation="horizontal" side="right" label="Resize operations area" value={Math.round(h)} min={140} max={480} onResize={(v, done) => {
        setH(v);
        if (done) void applyCustom({ op: 'set', section: 'layout', path: ['operations', 'height'], value: Math.round(v), label: 'Resized the operations area' }, { quiet: true });
      }} />
      <div className="ops-dock-head"><h2>Operations</h2></div>
      <OperationsList />
    </section>
  );
}

/** With a docked operations area, "Operations" (Ctrl+J) moves focus there instead of opening a panel. */
function OpsDockFocus() {
  useEffect(() => {
    document.getElementById('ops-dock')?.focus();
    document.getElementById('ops-dock')?.scrollIntoView({ block: 'nearest' });
    app.set({ opsPanelOpen: false });
  }, []);
  return null;
}

function Workspace({ layout }: { layout: Layout }) {
  const tab = useStore(ws, (s) => activeTab(s));
  const hasBg = useHasBackground('workspace');
  if (!tab) return null;
  const arrangement = layout.panes.arrangement;
  const panes = visiblePanes({ ...tab, arrangement } as Tab);
  return (
    <main className={`workspace ${hasBg ? 'has-bg' : ''}`}>
      {hasBg && <BackgroundLayer where="workspace" />}
      {panes.length === 1 ? (
        <Pane tabId={tab.id} pane={panes[0]!} index={0} isActive showStatus={layout.statusBar.visible} />
      ) : (
        <PaneGrid tab={tab} arrangement={arrangement} ratios={layout.panes.ratios} showStatus={layout.statusBar.visible} />
      )}
    </main>
  );
}

/**
 * Two to four independent panes. Each has its own location, history, view
 * and selection; transfers between them go through the operation queue.
 * Resizers are keyboard accessible (arrow keys, 5% steps).
 */
/** Width of the resizer track between panes: a hairline, or the panel spacing when panels float. */
const GUTTER = 'var(--pane-gutter, 1px)';

/** Soft ambient light behind the glass panels (Customization → Appearance → Ambient light). Decorative only. */
function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <i className="amb amb-1" />
      <i className="amb amb-2" />
      <i className="amb amb-3" />
    </div>
  );
}

function PaneGrid({ tab, arrangement, ratios, showStatus }: { tab: Tab; arrangement: Layout['panes']['arrangement']; ratios: number[]; showStatus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const g = ARRANGEMENT_GRID[arrangement];
  const panes = tab.panes.slice(0, paneCount({ ...tab, arrangement }));
  const fr = (a: number, b: number) => `minmax(0, ${Math.max(0.05, b - a)}fr)`;
  let cols: string;
  let rows: string;
  if (arrangement === 'quad') {
    cols = `${fr(0, ratios[0] ?? 0.5)} ${GUTTER} ${fr(ratios[0] ?? 0.5, 1)}`;
    rows = `${fr(0, ratios[1] ?? 0.5)} ${GUTTER} ${fr(ratios[1] ?? 0.5, 1)}`;
  } else if (g.rows > 1) {
    cols = 'minmax(0, 1fr)';
    rows = `${fr(0, ratios[0] ?? 0.5)} ${GUTTER} ${fr(ratios[0] ?? 0.5, 1)}`;
  } else {
    const pts = [0, ...ratios.slice(0, g.cols - 1), 1];
    cols = pts.slice(1).map((p, i) => fr(pts[i]!, p)).join(` ${GUTTER} `);
    rows = 'minmax(0, 1fr)';
  }
  const resizer = (axis: 'v' | 'h', index: number, key: string, style: React.CSSProperties) => {
    const value = ratios[index] ?? 0.5;
    const set = (v: number) => {
      const next = [...ratios];
      next[index] = v;
      // Split points stay in order with room for a pane between them.
      if (arrangement === 'triple') {
        if (index === 0) next[0] = Math.min(v, (next[1] ?? 0.67) - 0.15);
        else next[1] = Math.max(v, (next[0] ?? 0.33) + 0.15);
      }
      setPaneRatios(tab.id, next);
    };
    return (
      <div
        key={key}
        className={`pane-resizer ${axis}`}
        style={style}
        role="separator"
        aria-label={axis === 'v' ? 'Resize panes horizontally' : 'Resize panes vertically'}
        aria-orientation={axis === 'v' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={15}
        aria-valuemax={85}
        tabIndex={0}
        onKeyDown={(e) => {
          const dec = axis === 'v' ? 'ArrowLeft' : 'ArrowUp';
          const inc = axis === 'v' ? 'ArrowRight' : 'ArrowDown';
          if (e.key === dec) set(value - 0.05);
          if (e.key === inc) set(value + 0.05);
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const rect = ref.current!.getBoundingClientRect();
          const move = (ev: PointerEvent) => set(axis === 'v' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height);
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
    );
  };

  const cells: React.ReactNode[] = [];
  const place = (i: number, col: number, row: number) => {
    const p = panes[i];
    if (!p) return;
    cells.push(
      <div key={p.id} className="pane-cell" style={{ gridColumn: col, gridRow: row }}>
        <Pane tabId={tab.id} pane={p} index={i} isActive={tab.activePane === i} showStatus={showStatus} />
      </div>,
    );
  };
  if (arrangement === 'quad') {
    place(0, 1, 1); place(1, 3, 1); place(2, 1, 3); place(3, 3, 3);
    cells.push(resizer('v', 0, 'rv', { gridColumn: 2, gridRow: '1 / 4' }));
    cells.push(resizer('h', 1, 'rh', { gridColumn: '1 / 4', gridRow: 2 }));
  } else if (g.rows > 1) {
    place(0, 1, 1); place(1, 1, 3);
    cells.push(resizer('h', 0, 'rh', { gridColumn: 1, gridRow: 2 }));
  } else {
    panes.forEach((_, i) => place(i, i * 2 + 1, 1));
    for (let i = 0; i < g.cols - 1; i++) cells.push(resizer('v', i, `rv${i}`, { gridColumn: i * 2 + 2, gridRow: 1 }));
  }
  return (
    <div ref={ref} className={`panes-grid split arrangement-${arrangement}`} style={{ gridTemplateColumns: cols, gridTemplateRows: rows }}>
      {cells}
    </div>
  );
}
