import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { app, toastError } from '../state/app';
import { useStore } from '../state/store';
import {
  activeTab, currentLocation, ensureListing, isSplit, listingKeyFor, listings, navigate, parentPath, scrollMemory, setActivePane, setExtraEntries, setSelection, updatePane, ws, type Pane as PaneT,
} from '../state/workspace';
import { applyCustom as applyCustomOp, custom, useCustom } from '../state/custom';
import { openStudio } from './studio/studioState';
import { applySavedView } from './SavedViews';
import { BackgroundLayer, useHasBackground } from './Background';
import { entryMenu, backgroundMenu, newFileItems } from '../menus';
import { folderSizes, folderSizesActive, startFolderSizes, stopFolderSizes } from '../state/folderSizes';
import { JobPauseButton, useJobPaused } from './views/common';
import { call } from '../api';
import { loadStoredChecksums } from '../state/checksums';
import { Icon } from '../ui/Icon';
import { EmptyState, ErrorState, IconButton, Loading, SEP, useMenu, type MenuItem } from '../ui/components';
import { availability, command, commandById, getContext, runCommand, shortcutFor, type CommandContext } from '../commands';
import { allColumns, arrange, ColumnsView, GridView, ListView, META_COLUMNS, TreeView, type TagMap } from './FileViews';
import { openEntry } from '../actions';
import { StatusBar, locationTitle } from './Chrome';
import { PanelBoundary } from '../ui/PanelBoundary';
import { HomeView } from './views/HomeView';
import { ToolView } from './views/ToolViews';
import { CollectionView, LibraryView, SavedSearchView } from './views/LibraryViews';
import { ArchiveView } from './views/ArchiveView';
import { RemoteFolder, remoteCrumbs } from './views/RemoteView';
import { remoteAddress } from '../state/remote';
import { isCleanRemotePath, remoteRef } from '../../shared/remote';
import { ProjectView } from './views/ProjectsView';
import { EditorPane } from './EditorPane';
import { META_SORT_KEYS, locationKey, type FileEntry, type GroupKey, type Location, type ViewMode } from '../../shared/model';
import { META_EXTS, type MediaSummary } from '../../shared/media';
import { gitState, requestGit, type GitFolder } from '../state/git';
import { branchLabel } from '../../shared/git';

export function Pane({ tabId, pane, index, isActive, showStatus }: { tabId: string; pane: PaneT; index: number; isActive: boolean; showStatus: boolean }) {
  const loc = currentLocation(pane);
  const activate = () => {
    const t = ws.get().tabs.find((x) => x.id === tabId);
    if (t && t.activePane !== index) setActivePane(tabId, index);
  };
  return (
    <section className={`pane ${isActive ? 'is-active' : ''}`} aria-label={`Pane ${index + 1}`} onMouseDownCapture={activate}>
      <PaneToolbar tabId={tabId} pane={pane} />
      <div className="pane-body">
        <PanelBoundary label="view" resetKey={locationKey(loc)}>
        {loc.kind === 'fs' || loc.kind === 'search' ? (
          <DirectoryOrSearch tabId={tabId} pane={pane} isActive={isActive} showStatus={showStatus} />
        ) : loc.kind === 'home' ? (
          <HomeWithBackground paneId={pane.id} />
        ) : loc.kind === 'tool' ? (
          <ToolView tool={loc.tool} paneId={pane.id} />
        ) : loc.kind === 'collection' ? (
          <CollectionView id={loc.id} pane={pane} tabId={tabId} />
        ) : loc.kind === 'savedSearch' ? (
          <SavedSearchView id={loc.id} paneId={pane.id} />
        ) : loc.kind === 'library' ? (
          <LibraryView category={loc.category} pane={pane} tabId={tabId} />
        ) : loc.kind === 'project' ? (
          <ProjectView id={loc.id} pane={pane} tabId={tabId} />
        ) : loc.kind === 'archive' ? (
          <ArchiveView archivePath={loc.archivePath} paneId={pane.id} via={loc.via} rootDir={loc.rootDir} />
        ) : loc.kind === 'editor' ? (
          <EditorPane pane={pane} path={loc.path} />
        ) : loc.kind === 'remote' ? (
          <RemoteFolder tabId={tabId} pane={pane} isActive={isActive} showStatus={showStatus} />
        ) : null}
        </PanelBoundary>
      </div>
    </section>
  );
}

/** Home, with the Home background when one is configured (Customization → Appearance → Background). */
function HomeWithBackground({ paneId }: { paneId: string }) {
  const hasBg = useHasBackground('home');
  const scope = useCustom((r) => r.appearance.background.scope);
  if (!hasBg || scope !== 'home') return <HomeView paneId={paneId} />;
  return (
    <div className="home-bg has-bg">
      <BackgroundLayer where="home" />
      <HomeView paneId={paneId} />
    </div>
  );
}

/* ---------------------------------------------------------------- toolbar */

const SORT_LABELS = { name: 'Name', modified: 'Date modified', created: 'Date created', accessed: 'Date accessed', size: 'Size', type: 'Type', ext: 'Extension', tags: 'Tags', dimensions: 'Dimensions (read from files)', duration: 'Duration (read from files)', taken: 'Date taken (read from files)' } as const;
const GROUP_LABELS: Record<GroupKey, string> = { none: 'None', type: 'Type', kind: 'Category', modified: 'Date modified', created: 'Date created', size: 'Size', tags: 'Tags' };
export const VIEW_MODES: ViewMode[] = ['details', 'list', 'compact', 'grid', 'thumbnails', 'gallery', 'columns', 'tree'];

/** View, sort, multi-key sort and grouping for one pane (its own per-view preferences). */
export function viewMenuItems(pane: PaneT): MenuItem[] {
  const sortItems: MenuItem[] = [
    ...(Object.keys(SORT_LABELS) as Array<keyof typeof SORT_LABELS>).map((k) => ({ label: SORT_LABELS[k], checked: pane.sort.key === k, run: () => updatePane(pane.id, { sort: { ...pane.sort, key: k }, thenBy: pane.thenBy.filter((t) => t.key !== k) }) })),
    SEP,
    { label: 'Ascending', checked: pane.sort.dir === 'asc', run: () => updatePane(pane.id, { sort: { ...pane.sort, dir: 'asc' } }) },
    { label: 'Descending', checked: pane.sort.dir === 'desc', run: () => updatePane(pane.id, { sort: { ...pane.sort, dir: 'desc' } }) },
    { label: 'Folders first', checked: pane.sort.foldersFirst, run: () => updatePane(pane.id, { sort: { ...pane.sort, foldersFirst: !pane.sort.foldersFirst } }) },
  ];
  // Further sort keys, in priority order, used when the earlier keys are equal (then the name breaks ties).
  const thenItems: MenuItem[] = [
    ...pane.thenBy.map((t, i) => ({ label: `${i + 2}. ${SORT_LABELS[t.key]} (${t.dir === 'asc' ? 'ascending' : 'descending'})`, submenu: [
      { label: t.dir === 'asc' ? 'Make descending' : 'Make ascending', run: () => updatePane(pane.id, { thenBy: pane.thenBy.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' as const : 'asc' as const } : x)) }) },
      { label: 'Move up', disabled: i === 0, run: () => updatePane(pane.id, { thenBy: swap(pane.thenBy, i, i - 1) }) },
      { label: 'Remove', run: () => updatePane(pane.id, { thenBy: pane.thenBy.filter((_, j) => j !== i) }) },
    ] })),
    ...(pane.thenBy.length ? [SEP] : []),
    ...(pane.thenBy.length < 3 ? (Object.keys(SORT_LABELS) as Array<keyof typeof SORT_LABELS>).filter((k) => k !== pane.sort.key && !pane.thenBy.some((t) => t.key === k)).map((k) => ({ label: `Add ${SORT_LABELS[k]}`, run: () => updatePane(pane.id, { thenBy: [...pane.thenBy, { key: k, dir: 'asc' as const }] }) })) : [{ label: 'Up to three further keys', disabled: true, run: () => undefined }]),
  ];
  return [
    ...VIEW_MODES.map((v) => ({ label: command(`view.${v}`).title, icon: command(`view.${v}`).icon, checked: pane.view === v, shortcut: shortcutFor(`view.${v}`), run: () => updatePane(pane.id, { view: v }) })),
    SEP,
    { label: 'Sort by', icon: 'viewList', submenu: sortItems },
    { label: pane.thenBy.length ? `Then by (${pane.thenBy.length})` : 'Then by', icon: 'viewList', submenu: thenItems },
    { label: 'Group by', icon: 'collection', submenu: (['none', 'type', 'kind', 'modified', 'created', 'size', 'tags'] as GroupKey[]).map((g) => ({ label: GROUP_LABELS[g], checked: pane.groupBy === g, run: () => updatePane(pane.id, { groupBy: g }) })) },
    SEP,
    { label: 'Show hidden files', checked: app.get().settings.showHidden, shortcut: shortcutFor('view.hidden'), run: () => void runCommand('view.hidden') },
    ...(currentLocation(pane).kind === 'fs' ? [{ label: 'Calculate folder sizes', checked: folderSizesActive((currentLocation(pane) as { path: string }).path), shortcut: shortcutFor('view.folderSizes'), run: () => void runCommand('view.folderSizes', { ...getContext(), pane, location: currentLocation(pane), dir: (currentLocation(pane) as { path: string }).path }) }] : []),
    { label: 'Make this the default view', run: () => void runCommand('view.applyDefaults', { ...getContext(), pane }) },
    { label: 'Save view…', icon: 'save', run: () => void runCommand('view.saveView', { ...getContext(), pane }) },
    { label: 'Columns and view options…', icon: 'palette', run: () => openStudio('views') },
  ];
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
}

type TbItem = { id: string; pinned: boolean } | { separator: true };

/**
 * The pane toolbar, built from the toolbar configuration (Customization →
 * Toolbars): items in order, shown as icons, text or both. When the pane is
 * too narrow, unpinned items move into "More" (from the end), so every
 * command stays reachable. Every button runs its registered command.
 */
function PaneToolbar({ tabId, pane }: { tabId: string; pane: PaneT }) {
  const loc = currentLocation(pane);
  const viewMenu = useMenu();
  const newMenu = useMenu();
  const moreMenu = useMenu();
  const viewsMenu = useMenu();
  const cfg = useCustom((r) => r.toolbar);
  const vis = useCustom((r) => ({ toolbar: r.layout.toolbar.visible, address: r.layout.addressBar.visible, search: r.layout.searchBox.visible, details: r.layout.details.visible }));
  const savedViews = useStore(custom, (s) => s.server.config.savedViews);
  useStore(app, (s) => [s.clipboard, s.settings.showHidden]);
  useStore(ws, (s) => s.tabs.find((t) => t.id === tabId)?.arrangement);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  // Pane width at which the labelled toolbar was measured to overflow (it then shows icons up to a little wider).
  const [iconsAt, setIconsAt] = useState<number | null>(null);
  const itemsKey = JSON.stringify([cfg.start, cfg.end]);
  useEffect(() => setIconsAt(null), [cfg.presentation, itemsKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && cfg.presentation !== 'icon' && (iconsAt === null || width > iconsAt + 24) && el.scrollWidth > el.clientWidth + 1) setIconsAt(width);
  }, [cfg.presentation, iconsAt, width, itemsKey, loc.kind, vis.address, vis.search, vis.toolbar]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const ctx = (): CommandContext => ({ ...getContext(), pane, location: loc, dir: loc.kind === 'fs' ? loc.path : undefined });
  const isFs = loc.kind === 'fs';
  const isRemote = loc.kind === 'remote';

  const label = (id: string): string => (id === 'menu:new' ? 'New' : id === 'menu:view' ? 'View' : id === 'menu:views' ? 'Views' : id === 'menu:more' ? 'More' : commandById(id)?.title ?? id);
  const icon = (id: string): string => (id === 'menu:new' ? 'plus' : id === 'menu:view' ? command(`view.${pane.view}`).icon ?? 'viewDetails' : id === 'menu:views' ? 'save' : id === 'menu:more' ? 'more' : commandById(id)?.icon ?? 'command');
  // Width each item needs, for overflow: icon buttons are square; text adds roughly 7px per character.
  const ctrl = 34;
  const widthIn = (presentation: string, id: string) => (presentation === 'icon' ? ctrl : presentation === 'text' ? 16 + label(id).length * 7 : ctrl + 6 + label(id).length * 7);
  const relevant = (it: TbItem) => ('separator' in it ? true : it.id === 'menu:new' ? isFs || isRemote : true);
  const all = [...cfg.start.map((x) => ({ ...x, where: 'start' as const })), ...cfg.end.map((x) => ({ ...x, where: 'end' as const }))].filter(relevant);
  // Room kept for the address bar and the search box, matching their widths in app.css (narrow panes compact both).
  const searchW = !vis.search ? 0 : width <= 440 ? 34 : width <= 680 ? 130 : Math.min(300, Math.max(160, width * 0.22));
  const addressW = !vis.address ? 0 : width <= 440 ? 64 : width <= 680 ? 150 : 220;
  const reserved = addressW + searchW + 24 + (vis.address ? 8 : 0) + (vis.search ? 8 : 0);
  let budget = Math.max(0, width - reserved);
  // Pinned items always stay. When their labels do not fit (text or icons-and-text in a narrow pane),
  // the toolbar shows icons only rather than pushing More and the end of the toolbar out of the pane.
  const presentation = cfg.presentation !== 'icon' && iconsAt !== null && width <= iconsAt + 24 ? 'icon' : cfg.presentation;
  const itemWidth = (id: string) => widthIn(presentation, id);
  const shown = new Set<number>();
  // Pinned items always stay; the rest fill the remaining room from the start.
  all.forEach((it, i) => {
    if (!('separator' in it) && (it.pinned || it.id === 'menu:more')) {
      shown.add(i);
      budget -= itemWidth(it.id);
    }
  });
  all.forEach((it, i) => {
    if ('separator' in it || shown.has(i)) return;
    const w = itemWidth(it.id);
    if (budget - w >= 0) {
      shown.add(i);
      budget -= w;
    }
  });
  const overflow = all.filter((it, i) => !('separator' in it) && !shown.has(i)) as Array<{ id: string; pinned: boolean }>;

  const openAt = (m: ReturnType<typeof useMenu>, items: MenuItem[], e: React.MouseEvent, anchor: 'left' | 'right' = 'right') => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    m.open(items, anchor === 'right' ? r.right : r.left, r.bottom + 4, anchor);
  };
  const newItems = (): MenuItem[] => {
    const c = command('file.newFolder');
    const a = availability(c, ctx());
    const folder = { label: c.title, icon: c.icon, shortcut: shortcutFor(c.id), disabled: !a.enabled, reason: a.reason, run: () => void runCommand(c.id, ctx()) };
    // On a server only folders are created here; files arrive by copying or dropping them in.
    if (isRemote) return [folder];
    return [folder, SEP, ...newFileItems(ctx(), pane.id)];
  };
  const viewsItems = (): MenuItem[] => [
    ...savedViews.map((v) => ({ label: v.name, icon: command(`view.${v.view}`).icon, run: () => void applySavedView(pane, v.id) })),
    ...(savedViews.length ? [SEP] : []),
    { label: 'Save view…', icon: 'save', run: () => void runCommand('view.saveView', { ...ctx() }) },
    { label: 'Manage saved views…', icon: 'palette', run: () => openStudio('views') },
  ];
  const cmdMenuItem = (id: string): MenuItem => {
    if (id === 'menu:new') return { label: 'New', icon: 'plus', submenu: newItems() };
    if (id === 'menu:view') return { label: 'View, sort and group', icon: icon(id), submenu: viewMenuItems(pane) };
    if (id === 'menu:views') return { label: 'Saved views', icon: 'save', submenu: viewsItems() };
    const c = commandById(id);
    if (!c) return { label: id, disabled: true, reason: 'Not available in this version.' };
    const a = availability(c, ctx());
    return { label: c.title, icon: c.icon, shortcut: shortcutFor(id), disabled: !a.enabled, reason: a.reason, danger: c.risk === 'destructive', run: () => void runCommand(id, ctx()) };
  };
  const moreItems = (): MenuItem[] => {
    const extra = overflow.filter((o) => o.id !== 'menu:more').map((o) => cmdMenuItem(o.id));
    const always = ['edit.selectAll', 'edit.invertSelection', 'file.copyPath', 'file.reveal', 'file.pin', 'nav.split', 'nav.swapPanes', 'view.inspector', 'nav.newWindow', 'app.saveTabSet', 'app.openTabSet', 'app.customize']
      .filter((id) => !all.some((x) => !('separator' in x) && x.id === id && shown.has(all.indexOf(x))) && !overflow.some((o) => o.id === id))
      .map(cmdMenuItem);
    return [...extra, ...(extra.length ? [SEP] : []), ...always, SEP, { label: 'Customize toolbar…', icon: 'palette', run: () => openStudio('toolbars') }];
  };

  const render = (it: TbItem & { where: string }, i: number) => {
    if ('separator' in it) return <span key={`sep-${i}`} className="tb-sep" role="separator" aria-orientation="vertical" />;
    if (!shown.has(i)) return null;
    const id = it.id;
    const text = presentation !== 'icon';
    const iconOn = presentation !== 'text';
    let onClick: (e: React.MouseEvent) => void;
    let disabled = false;
    let reason: string | undefined;
    let active: boolean | undefined;
    if (id === 'menu:new') onClick = (e) => openAt(newMenu, newItems(), e, 'left');
    else if (id === 'menu:view') onClick = (e) => openAt(viewMenu, viewMenuItems(pane), e);
    else if (id === 'menu:views') onClick = (e) => openAt(viewsMenu, viewsItems(), e);
    else if (id === 'menu:more') onClick = (e) => openAt(moreMenu, moreItems(), e);
    else {
      const c = commandById(id);
      if (!c) return null;
      const a = availability(c, ctx());
      disabled = !a.enabled;
      reason = a.reason;
      if (id === 'nav.split') active = isSplit(ws.get().tabs.find((t) => t.id === tabId) ?? activeTab());
      if (id === 'view.inspector') active = vis.details;
      onClick = () => void runCommand(id, ctx());
    }
    const lbl = label(id);
    const full = disabled ? `${id === 'menu:view' ? 'View, sort and group' : lbl} — ${reason ?? 'unavailable'}` : id === 'menu:view' ? 'View, sort and group' : id === 'menu:more' ? 'More actions' : lbl;
    if (!text) return <IconButton key={id} icon={icon(id)} label={full} shortcut={id.startsWith('menu:') ? undefined : shortcutFor(id)} disabled={disabled} active={active} aria-haspopup={id.startsWith('menu:') ? 'menu' : undefined} onClick={onClick} />;
    return (
      <button key={id} type="button" className={`tb-btn ${active ? 'is-active' : ''}`} aria-label={full} aria-pressed={active} aria-haspopup={id.startsWith('menu:') ? 'menu' : undefined} disabled={disabled} data-tip={shortcutFor(id) && !id.startsWith('menu:') ? `${full} (${shortcutFor(id)})` : undefined} onClick={onClick}>
        {iconOn && <Icon name={icon(id)} size={15} />}
        <span>{lbl}</span>
      </button>
    );
  };

  if (!vis.toolbar && !vis.address && !vis.search) return null;
  const startItems = all.map((it, i) => ({ it, i })).filter((x) => x.it.where === 'start');
  const endItems = all.map((it, i) => ({ it, i })).filter((x) => x.it.where === 'end');
  return (
    <div className={`pane-toolbar tb-${presentation}`} role="toolbar" aria-label="Pane toolbar" ref={ref}>
      {vis.toolbar && <div className="tb-group">{startItems.map(({ it, i }) => render(it, i))}</div>}
      {vis.address ? <AddressBar tabId={tabId} pane={pane} /> : <span className="tb-flex" />}
      {vis.search && <SearchBox pane={pane} />}
      {vis.toolbar ? <div className="tb-group">{endItems.map(({ it, i }) => render(it, i))}</div> : (
        <IconButton icon="more" label="More actions" onClick={(e) => openAt(moreMenu, moreItems(), e)} />
      )}
      {viewMenu.node}
      {newMenu.node}
      {moreMenu.node}
      {viewsMenu.node}
    </div>
  );
}

function AddressBar({ pane }: { tabId: string; pane: PaneT }) {
  const loc = currentLocation(pane);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLDivElement>(null);
  const menu = useMenu();

  useEffect(() => {
    const focus = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== pane.id) return;
      setText(loc.kind === 'fs' || loc.kind === 'remote' ? loc.path : '');
      setEditing(true);
    };
    document.addEventListener('orbis:focus-address', focus);
    return () => document.removeEventListener('orbis:focus-address', focus);
  }, [pane.id, loc]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  useLayoutEffect(() => {
    // Keep the end of long paths visible, also when the pane gets narrower or wider.
    const el = crumbsRef.current;
    if (!el) return;
    const toEnd = () => {
      el.scrollLeft = el.scrollWidth;
      el.classList.toggle('is-clipped', el.scrollWidth > el.clientWidth + 1);
    };
    toEnd();
    const ro = new ResizeObserver(toEnd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loc, editing]);

  const submit = async () => {
    if (loc.kind === 'remote') {
      // A path on the same server: absolute, or relative to the folder shown.
      const t = text.trim();
      const target = t.startsWith('/') ? t : `${loc.path === '/' ? '' : loc.path}/${t}`;
      const clean = target.length > 1 ? target.replace(/\/+$/, '') : target;
      if (!isCleanRemotePath(clean)) {
        setError('Type an absolute path on this server, such as /home/me (no “..”).');
        return;
      }
      const st = await call<{ kind: string }>('remote:stat', { ref: remoteRef(loc.connectionId, clean) }).catch((err) => ({ kind: '', error: err as { shape?: { message?: string } } }));
      if (st.kind !== 'directory') {
        setError('error' in st ? (st.error.shape?.message ?? 'This folder does not exist on the server.') : 'This is not a folder on the server.');
        return;
      }
      setError(undefined);
      setEditing(false);
      await navigate(pane.id, { kind: 'remote', connectionId: loc.connectionId, path: clean });
      return;
    }
    const base = loc.kind === 'fs' ? loc.path : undefined;
    const r = await call<{ path: string; exists: boolean; kind?: string; error?: { message: string } }>('fs:resolve', { input: text, base }).catch(() => undefined);
    if (!r || !r.exists) {
      setError(r?.error?.message ?? 'This location does not exist.');
      return;
    }
    setError(undefined);
    setEditing(false);
    await navigate(pane.id, { kind: 'fs', path: r.path });
  };

  if (editing) {
    return (
      <div className={`address editing ${error ? 'has-error' : ''}`}>
        <input
          ref={input}
          className="mono"
          value={text}
          aria-label="Path"
          aria-invalid={!!error}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') {
              setEditing(false);
              setError(undefined);
            }
          }}
          onBlur={() => !error && setEditing(false)}
        />
        {error && <span className="address-error" role="alert">{error}</span>}
      </div>
    );
  }

  let crumbs: Array<{ label: string; path?: string; file?: boolean; remote?: string; title?: string }> = [];
  if (loc.kind === 'remote') {
    crumbs = remoteCrumbs(loc.connectionId, loc.path).map((c) => ({ label: c.label, remote: c.path, title: c.title }));
  } else if (loc.kind === 'fs' || loc.kind === 'editor') {
    const sep = loc.path.includes('\\') && !loc.path.startsWith('/') ? '\\' : '/';
    const parts = loc.path.split(/[\\/]/).filter(Boolean);
    let acc = sep === '/' ? '' : '';
    crumbs = sep === '/' ? [{ label: '/', path: '/' }] : [];
    parts.forEach((p, i) => {
      acc = sep === '/' ? `${acc}/${p}` : i === 0 ? `${p}\\` : `${acc.replace(/\\$/, '')}\\${p}`;
      // In the editor the last part is the file itself (not a place to go to).
      const file = loc.kind === 'editor' && i === parts.length - 1;
      crumbs.push({ label: p, path: file ? undefined : acc, file });
    });
  } else {
    const prefix: Partial<Record<Location['kind'], string>> = { tool: 'Tools', library: 'Library', collection: 'Collection', savedSearch: 'Saved search', project: 'Project' };
    const label = loc.kind === 'home' ? 'Home' : loc.kind === 'search' ? `Search “${loc.query}”` : loc.kind === 'archive' ? `Archive · ${[...(loc.via ?? []), loc.archivePath.split(/[\\/]/).pop()].join(' › ')}` : `${prefix[loc.kind] ? `${prefix[loc.kind]} · ` : ''}${locationTitle(loc)}`;
    crumbs = [{ label }];
  }

  return (
    <div className="address" onDoubleClick={() => { setText(loc.kind === 'fs' || loc.kind === 'remote' ? loc.path : ''); setEditing(true); }} onContextMenu={(e) => {
      if (loc.kind === 'remote') {
        e.preventDefault();
        const addr = remoteAddress(remoteRef(loc.connectionId, loc.path));
        menu.open([
          { label: 'Copy server address', icon: 'link', disabled: !addr, run: () => void call('fs:copyText', { text: addr ?? '' }) },
          { label: 'Edit path', icon: 'rename', shortcut: shortcutFor('nav.address'), run: () => { setText(loc.path); setEditing(true); } },
        ], e.clientX, e.clientY);
        return;
      }
      if (loc.kind !== 'fs') return;
      e.preventDefault();
      menu.open([
        { label: 'Copy path', icon: 'path', run: () => void call('fs:copyText', { text: loc.path }) },
        { label: 'Edit path', icon: 'rename', shortcut: shortcutFor('nav.address'), run: () => { setText(loc.path); setEditing(true); } },
      ], e.clientX, e.clientY);
    }}>
      <div className="crumbs" ref={crumbsRef}>
        {crumbs.map((c, i) => (
          <React.Fragment key={`${c.path ?? c.label}-${i}`}>
            {i > 0 && crumbs[i - 1]!.label !== '/' && <Icon name="chevronRight" size={12} className="crumb-sep" />}
            {c.remote !== undefined && loc.kind === 'remote' ? (
              <button type="button" className={`crumb ${i === 0 ? 'crumb-server' : ''}`} onClick={() => navigate(pane.id, { kind: 'remote', connectionId: loc.connectionId, path: c.remote! })} title={c.title}>
                {i === 0 && <Icon name="server" size={12} />}
                <span className="crumb-label">{c.label}</span>
              </button>
            ) : c.path ? (
              <button type="button" className="crumb" onClick={() => navigate(pane.id, { kind: 'fs', path: c.path! })} title={c.path}>
                {c.label}
              </button>
            ) : (
              <span className={`crumb static ${c.file ? 'crumb-file' : ''}`} title={c.file && loc.kind === 'editor' ? loc.path : undefined}>{c.label}</span>
            )}
          </React.Fragment>
        ))}
      </div>
      <button type="button" className="address-edit" aria-label="Edit path" title={`Edit path (${shortcutFor('nav.address')})`} onClick={() => { setText(loc.kind === 'fs' || loc.kind === 'remote' ? loc.path : ''); setEditing(true); }}>
        <Icon name="rename" size={13} />
      </button>
      {menu.node}
    </div>
  );
}

function SearchBox({ pane }: { pane: PaneT }) {
  const loc = currentLocation(pane);
  const [q, setQ] = useState(loc.kind === 'search' ? loc.query : '');
  const [hint, setHint] = useState<string | undefined>();
  const ref = useRef<HTMLInputElement>(null);
  const scope = loc.kind === 'fs' ? [loc.path] : loc.kind === 'search' ? loc.scope : loc.kind === 'editor' && parentPath(loc.path) ? [parentPath(loc.path)!] : app.get().known.filter((k) => k.id === 'home').map((k) => k.path);

  useEffect(() => {
    const focus = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pane.id) ref.current?.focus();
    };
    document.addEventListener('orbis:focus-search', focus);
    return () => document.removeEventListener('orbis:focus-search', focus);
  }, [pane.id]);
  useEffect(() => {
    if (loc.kind !== 'search') setQ('');
  }, [loc.kind]);

  useEffect(() => {
    if (!q.trim()) {
      setHint(undefined);
      return;
    }
    const t = setTimeout(() => {
      void call<{ ok: boolean; message?: string }>('search:parse', { query: q }).then((r) => setHint(r.ok ? undefined : r.message), () => undefined);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const scopeLabel = loc.kind === 'fs' ? loc.path.split(/[\\/]/).filter(Boolean).pop() ?? loc.path : loc.kind === 'search' ? 'current scope' : 'Home';
  if (loc.kind === 'remote') {
    return (
      <div className="searchbox is-disabled" title="Searching is not available on servers. Use the filter (it appears for folders with many items), or copy the folder to this computer.">
        <Icon name="search" size={14} />
        <input disabled placeholder="Search not available here" aria-label="Search (not available on a server)" />
      </div>
    );
  }
  return (
    <div className={`searchbox ${hint ? 'has-error' : ''}`} title={hint ?? 'Search names, or use filters like type:pdf size:>10MB modified:last7days tag:work rating:>=4 width:>1920 duration:>5m project:name'}>
      <Icon name="search" size={14} />
      <input
        ref={ref}
        value={q}
        placeholder={`Search ${scopeLabel}`}
        aria-label={`Search in ${scopeLabel}`}
        aria-invalid={!!hint}
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim() && !hint) void navigate(pane.id, { kind: 'search', query: q.trim(), scope });
          if (e.key === 'Escape') {
            setQ('');
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {hint && <span className="search-hint" role="alert">{hint}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- directory / search content */

function DirectoryOrSearch({ tabId, pane, isActive, showStatus }: { tabId: string; pane: PaneT; isActive: boolean; showStatus: boolean }) {
  const key = listingKeyFor(tabId, pane);
  useEffect(() => {
    ensureListing(tabId, pane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const listing = useStore(listings, (s) => s[key]);
  const loc = currentLocation(pane);
  const [tags, setTags] = useState<TagMap>({});
  const [meta, setMeta] = useState<Record<string, MediaSummary>>({});
  const [metaNote, setMetaNote] = useState<string | undefined>();
  const [owners, setOwners] = useState<Record<number, string>>({});
  const columns = useCustom((r) => r.view.columns);
  const tagDots = useCustom((r) => r.navigation.indicators.tagDots);
  const tagCol = useStore(app, (s) => s.tags.length > 0) && (columns.some((c) => c.id === 'tags' && c.visible) || tagDots);
  const catVersion = useStore(app, (s) => s.tags);
  const menu = useMenu();
  const visibleCols = useMemo(() => new Set<string>(allColumns(columns).filter((c) => c.visible).map((c) => c.id)), [columns]);
  const needsMeta = (pane.view === 'details' && [...META_COLUMNS].some((c) => visibleCols.has(c))) || META_SORT_KEYS.has(pane.sort.key) || pane.thenBy.some((t) => META_SORT_KEYS.has(t.key));
  const needsOwners = pane.view === 'details' && visibleCols.has('owner');

  const sizes = useStore(folderSizes, (s) => (loc.kind === 'fs' ? s[loc.path] : undefined));
  const rows = useMemo(() => arrange(listing?.entries ?? [], pane.sort, pane.groupBy, pane.filter, { tags, meta, folderSizes: sizes?.sizes }, pane.thenBy), [listing?.entries, pane.sort, pane.thenBy, pane.groupBy, pane.filter, tags, meta, sizes?.sizes]);

  useEffect(() => {
    if (!tagCol || !listing?.entries.length || listing.entries.length > 20000) return;
    void call<typeof tags>('cat:tagsFor', { paths: listing.entries.map((e) => e.path) }).then(setTags, () => undefined);
  }, [listing?.entries, tagCol, catVersion]);

  // Embedded metadata (dimensions, duration, date taken) is read only when a visible column or the sort needs it.
  useEffect(() => {
    if (!needsMeta || !listing?.entries.length || listing.status === 'loading') return;
    let cancelled = false;
    const media = listing.entries.filter((e) => e.kind === 'file' && META_EXTS.has(e.ext)).map((e) => e.path);
    const LIMIT = 5000;
    setMetaNote(media.length > LIMIT ? `Details read from files are shown for the first ${LIMIT.toLocaleString()} of ${media.length.toLocaleString()} media files.` : undefined);
    void (async () => {
      const acc: Record<string, MediaSummary> = {};
      for (let i = 0; i < Math.min(media.length, LIMIT) && !cancelled; i += 500) {
        Object.assign(acc, await call<Record<string, MediaSummary>>('meta:summaries', { paths: media.slice(i, i + 500) }).catch(() => ({})));
        if (!cancelled) setMeta({ ...acc });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listing?.entries, listing?.status, needsMeta]);

  // Stored checksums (calculated in this or an earlier session) for the files shown, when the Checksum column is visible.
  const needsChecksums = pane.view === 'details' && visibleCols.has('checksum');
  useEffect(() => {
    if (!needsChecksums || !listing?.entries.length || listing.status === 'loading') return;
    const signal = { cancelled: false };
    void loadStoredChecksums(listing.entries, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [listing?.entries, listing?.status, needsChecksums]);

  useEffect(() => {
    if (!needsOwners || !listing?.entries.length) return;
    const uids = [...new Set(listing.entries.map((e) => e.uid).filter((x): x is number => x !== undefined))].slice(0, 10000);
    if (!uids.length) return;
    void call<{ users: Record<number, string> }>('fs:owners', { uids, gids: [] }).then((r) => setOwners(r.users), () => undefined);
  }, [listing?.entries, needsOwners]);

  useEffect(() => () => setExtraEntries(pane.id, null), [pane.id]);

  // Git decorations: asked for after the folder is listed (the listing never waits for git), again whenever the
  // listing is refreshed (watch events, operations, F5) and when the window comes back to the front.
  const gitOn = useStore(app, (s) => s.settings.gitIntegration);
  const fsDir = loc.kind === 'fs' ? loc.path : undefined;
  const git = useStore(gitState, (s) => (fsDir ? s.byDir[fsDir] : undefined));
  const gitAsked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!fsDir || listing?.status !== 'ready') return;
    requestGit(fsDir, gitAsked.current === fsDir);
    gitAsked.current = fsDir;
  }, [fsDir, listing?.status, listing?.loadedMs, gitOn]);
  useEffect(() => {
    if (!fsDir || !gitOn) return;
    const onFocus = () => requestGit(fsDir, true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fsDir, gitOn]);

  const selectedEntries = useMemo(() => {
    const set = new Set(pane.selection);
    return (listing?.entries ?? []).filter((e) => set.has(e.path));
  }, [listing?.entries, pane.selection]);
  const selectedBytes = selectedEntries.every((e) => e.kind !== 'directory') ? selectedEntries.reduce((a, e) => a + (e.size ?? 0), 0) : undefined;

  const onContext = (e: React.MouseEvent, entry?: FileEntry) => {
    const ctx = getContext(entry);
    menu.open(entry ? entryMenu(ctx, entry) : backgroundMenu(ctx), e.clientX, e.clientY);
  };

  const dir = loc.kind === 'fs' ? loc.path : undefined;
  const viewProps = {
    rows,
    selection: pane.selection,
    focus: pane.focus,
    view: pane.view,
    sort: pane.sort,
    active: isActive,
    scrollTop: pane.scrollTop,
    dropDir: dir,
    tags,
    meta,
    owners,
    showLocation: loc.kind === 'search',
    folderSizes: sizes,
    git,
    thenBy: pane.thenBy,
    onSort: (sort: PaneT['sort']) => updatePane(pane.id, { sort, thenBy: pane.thenBy.filter((t) => t.key !== sort.key) }),
    onSelect: (paths: string[], anchor?: string, focus?: string) => setSelection(pane.id, paths, anchor, focus),
    onOpen: (e: FileEntry, mode: 'here' | 'tab') => void openEntry(pane.id, e, mode),
    onContext,
    onScroll: (top: number) => scrollMemory.set(pane.id, top),
    onActivate: () => undefined,
  };

  let body: React.ReactNode;
  if (!listing || (listing.status === 'loading' && !listing.entries.length)) body = <Loading label={`Reading ${loc.kind === 'fs' ? loc.path : 'results'}…`} />;
  else if (listing.status === 'error' && listing.error) {
    const e = listing.error;
    body = (
      <ErrorState
        title={e.category === 'permission_denied' ? 'You don’t have permission to open this folder' : e.category === 'not_found' ? 'This folder no longer exists' : e.category === 'unavailable' ? 'This location is not available' : 'This folder could not be read'}
        body={e.category === 'not_found' ? 'It may have been moved, renamed or deleted, or its drive was disconnected.' : e.message}
        errorId={e.errorId}
      >
        <button type="button" className="btn btn-default btn-md" onClick={() => void runCommand('nav.refresh')}>Try again</button>
        <button type="button" className="btn btn-ghost btn-md" onClick={() => void runCommand('nav.up')}>Go to parent folder</button>
      </ErrorState>
    );
  } else if (!rows.length && !listing.search) {
    body = pane.filter ? (
      <EmptyState icon="search" title="No items match the filter" body={`Nothing in this folder contains “${pane.filter}”.`}>
        <button type="button" className="btn btn-default btn-md" onClick={() => updatePane(pane.id, { filter: '' })}>Clear filter</button>
      </EmptyState>
    ) : (
      <EmptyState icon="folderOpen" title="This folder is empty" body={app.get().settings.showHidden ? undefined : 'Hidden items are not shown.'}>
        <button type="button" className="btn btn-default btn-md" onClick={() => void runCommand('file.newFolder')}>New folder</button>
      </EmptyState>
    );
  } else if (pane.view === 'columns' && dir) {
    body = <ColumnsView dir={dir} selection={pane.selection} onSelect={viewProps.onSelect} onOpen={(e) => void openEntry(pane.id, e)} onContext={onContext} onNavigate={(d, select) => void navigate(pane.id, { kind: 'fs', path: d }, { select })} onActivate={() => undefined} />;
  } else if (pane.view === 'tree' && dir) {
    body = <TreeView {...viewProps} paneId={pane.id} root={dir} onExtraEntries={(extra) => setExtraEntries(pane.id, extra)} />;
  } else if (pane.view === 'grid' || pane.view === 'gallery' || pane.view === 'thumbnails') body = <GridView {...viewProps} />;
  else body = <ListView {...viewProps} view={pane.view === 'columns' || pane.view === 'tree' ? 'details' : pane.view} />;

  return (
    <div className="pane-content" data-pane={pane.id}>
      {listing?.search && <SearchHeader pane={pane} listingKey={key} />}
      {loc.kind === 'fs' && listing && listing.entries.length > 0 && (pane.filter || listing.entries.length > 40) && (
        <div className="filterbar">
          <Icon name="search" size={13} />
          <input value={pane.filter} placeholder="Filter this folder" aria-label="Filter this folder" onChange={(e) => updatePane(pane.id, { filter: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && updatePane(pane.id, { filter: '' })} />
          {pane.filter && <span className="muted tabular">{rows.filter((r) => r.type === 'item').length.toLocaleString()} of {listing.entries.length.toLocaleString()}</span>}
          <SavedFilters pane={pane} />
        </div>
      )}
      {metaNote && <div className="pane-note muted">{metaNote}</div>}
      {sizes && <FolderSizesNote dir={sizes.dir} view={pane.view} />}
      <div className="pane-view">{body}</div>
      {showStatus && <StatusBar count={listing?.entries.length} selected={pane.selection.length} selectedBytes={selectedBytes} loading={listing?.status === 'loading'} watching={loc.kind === 'fs' ? listing?.watching : undefined} extra={<GitStatus git={git} looksLikeRepo={!!listing?.entries.some((e) => e.name === '.git')} />} />}
      {menu.node}
    </div>
  );
}

/** Branch (with ahead/behind) and change count in the status bar; "Git not found" where it matters. */
function GitStatus({ git, looksLikeRepo }: { git?: GitFolder; looksLikeRepo: boolean }) {
  if (!git || git.state === 'none' || git.state === 'off') return null;
  if (git.state === 'unavailable') return looksLikeRepo ? <span className="muted status-git" title={`${git.reason} Branch and change badges need the git program.`}><Icon name="gitBranch" size={13} />Git not found</span> : null;
  if (git.state === 'error') return <span className="muted status-git" title={git.message}><Icon name="gitBranch" size={13} />Git status unavailable</span>;
  const b = git.branch;
  const tip = [`Repository: ${git.root}`, b.upstream ? `Upstream: ${b.upstream}${b.ahead || b.behind ? ` (${b.ahead ?? 0} ahead, ${b.behind ?? 0} behind)` : ' (up to date)'}` : 'No upstream branch', `${git.changes.toLocaleString()} changed item${git.changes === 1 ? '' : 's'} in the repository`, git.truncated ? `Status limited to the first ${git.limit.toLocaleString()} entries; badges may be missing.` : `git status took ${git.durationMs} ms`].join('\n');
  return (
    <span className="status-git tabular" title={tip}>
      <Icon name="gitBranch" size={13} />
      <span className="status-git-branch">{branchLabel(b)}</span>
      {git.changes > 0 && <span className="muted">· {git.changes.toLocaleString()} change{git.changes === 1 ? '' : 's'}</span>}
      {git.truncated && <span className="warning-text">· limited to {git.limit.toLocaleString()} entries</span>}
    </span>
  );
}

/** Progress and controls of "Calculate folder sizes" for the folder shown. */
function FolderSizesNote({ dir, view }: { dir: string; view: string }) {
  const st = useStore(folderSizes, (s) => s[dir]);
  const paused = useJobPaused(st?.jobId);
  if (!st) return null;
  const done = Object.keys(st.sizes).length;
  const partial = Object.values(st.sizes).filter((x) => !x.complete).length;
  const where = view === 'details' ? 'in the Size column' : 'in the Size column of the Details view';
  const text = st.running
    ? `${paused ? 'Paused' : 'Calculating folder sizes'}: ${done.toLocaleString()} of ${st.total ? st.total.toLocaleString() : '…'} folders${st.current ? ` · ${st.current.split(/[\\/]/).pop()}` : ''}`
    : st.error
      ? `Folder sizes could not be calculated: ${st.error}`
      : `Folder sizes calculated ${where} (${done.toLocaleString()} of ${st.total.toLocaleString()} folder${st.total === 1 ? '' : 's'}${st.cancelled ? ', stopped early' : ''}${partial ? `; ${partial} shown as “at least”` : ''}). They are not updated automatically.`;
  return (
    <div className="pane-note folder-sizes-note" role="status" aria-live="polite">
      <Icon name="storage" size={13} />
      <span className="grow">{text}</span>
      {st.running && <JobPauseButton jobId={st.jobId} size="sm" />}
      {st.running && <button type="button" className="btn btn-default btn-sm" onClick={() => stopFolderSizes(dir, false)}>Stop</button>}
      {!st.running && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startFolderSizes(dir)}>Recalculate</button>}
      {!st.running && <button type="button" className="btn btn-ghost btn-sm" onClick={() => stopFolderSizes(dir)}>Clear</button>}
    </div>
  );
}

/** Filters saved in the active workspace (Customization → Workspaces). */
function SavedFilters({ pane }: { pane: PaneT }) {
  const list = useStore(custom, (s) => s.server.config.workspaces.find((w) => w.id === s.server.config.activeWorkspaceId)?.savedFilters ?? []);
  const menu = useMenu();
  const items = (): MenuItem[] => [
    ...list.map((f) => ({ label: f.name, checked: pane.filter === f.filter, run: () => updatePane(pane.id, { filter: f.filter }) })),
    ...(list.length ? [SEP] : []),
    { label: 'Save this filter…', icon: 'save', disabled: !pane.filter.trim(), reason: 'Type a filter first.', run: async () => {
      const name = await (await import('../state/app')).prompt({ title: 'Save filter', label: 'Name', initial: pane.filter.slice(0, 40), confirmLabel: 'Save' });
      if (name) await applyCustomOp({ op: 'addSavedFilter', name, filter: pane.filter });
    } },
    ...(list.length ? [{ label: 'Remove a saved filter', submenu: list.map((f) => ({ label: f.name, run: () => void applyCustomOp({ op: 'removeSavedFilter', id: f.id }) })) }] : []),
  ];
  return (
    <>
      <IconButton icon="save" label="Saved filters" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); menu.open(items(), r.right, r.bottom + 4, 'right'); }} />
      {menu.node}
    </>
  );
}

function SearchHeader({ pane, listingKey }: { pane: PaneT; listingKey: string }) {
  const listing = useStore(listings, (s) => s[listingKey]);
  const loc = currentLocation(pane);
  if (!listing?.search || loc.kind !== 'search') return null;
  const s = listing.search;
  const r = s.report;
  return (
    <div className="search-header" role="status" aria-live="polite">
      <div>
        <strong>{listing.entries.length.toLocaleString()}</strong> result{listing.entries.length === 1 ? '' : 's'} for <code>{s.query}</code>
        <span className="muted"> in {loc.scope.map((x) => x.split(/[\\/]/).filter(Boolean).pop() ?? x).join(', ')}</span>
        {s.running && <span className="muted"> · searching…</span>}
        {r && (
          <span className="muted">
            {' '}· {r.usedIndex.length ? 'used the index' : 'searched the folders directly'} · {r.scanned.toLocaleString()} items checked
            {r.complete ? '' : r.cancelled ? ' · stopped early' : ' · incomplete'}
          </span>
        )}
        {r?.notes.map((n) => <div key={n} className="warning-text">{n}</div>)}
        {s.error && <div className="error-text">{s.error.message}</div>}
      </div>
      <div className="tb-group">
        {s.running && <button type="button" className="btn btn-default btn-sm" onClick={() => void import('../state/workspace').then((m) => m.cancelSearch(listingKey))}>Stop</button>}
        {!s.running && (
          <button type="button" className="btn btn-default btn-sm" onClick={async () => {
            const { prompt } = await import('../state/app');
            const name = await prompt({ title: 'Save search', label: 'Name', initial: s.query, confirmLabel: 'Save' });
            if (name) await call('cat:saveSearch', { name, query: s.query, scope: loc.scope }).catch(toastError);
          }}>Save search</button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- context menus: see ../menus.ts */
export { entryMenu, backgroundMenu } from '../menus';
