import React, { useLayoutEffect, useRef, useState } from 'react';
import { app, opsActive, prompt } from '../state/app';
import { useStore } from '../state/store';
import {
  activateTab, closeOtherTabs, closeTab, closeTabsToRight, createGroup, currentLocation, duplicateTab, moveTab, openTab, renameGroup, setTabGroup,
  moveGroup, toggleGroup, togglePinTab, ungroup, ws, type Tab, isSplit, paneCount, activePane,
} from '../state/workspace';
import { applyCustom, custom } from '../state/custom';
import { openStudio } from './studio/studioState';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { IconButton, SEP, useMenu, type MenuItem } from '../ui/components';
import { shortcutFor, runCommand } from '../commands';
import { jobs } from '../state/jobs';
import { shares } from '../state/shares';
import { automation } from '../state/automation';
import { schedules } from '../state/backups';
import { TERMINAL_STATES } from '../../shared/operations';
import { editorUi } from '../state/editor';
import type { Location } from '../../shared/model';
import { connectionOf } from '../state/remote';
import { SpaceSwitcher } from './SpaceSwitcher';

export function locationTitle(loc: Location): string {
  switch (loc.kind) {
    case 'home': return 'Home';
    case 'fs': {
      const parts = loc.path.split(/[\\/]/).filter(Boolean);
      return parts[parts.length - 1] ?? loc.path;
    }
    case 'search': return `Search: ${loc.query}`;
    case 'collection': return app.get().collections.find((c) => c.id === loc.id)?.name ?? 'Collection';
    case 'savedSearch': return app.get().savedSearches.find((s) => s.id === loc.id)?.name ?? 'Saved search';
    case 'archive': return loc.archivePath.split(/[\\/]/).pop() ?? 'Archive';
    case 'library': {
      const c = loc.category;
      if (c === 'generated') return 'AI-generated';
      if (c === 'recent') return 'Recent';
      if (c === 'tags') return 'Tags';
      if (c.startsWith('tag:')) return app.get().tags.find((t) => t.id === c.slice(4))?.name ?? 'Tag';
      if (c.startsWith('provider:')) return app.get().providers.find((p) => p.id === c.slice(9))?.label ?? 'Orbis content';
      return c;
    }
    case 'project': return app.get().projects.find((p) => p.id === loc.id)?.name ?? 'Project';
    case 'editor': return loc.path.split(/[\\/]/).pop() || loc.path;
    case 'remote': {
      const name = connectionOf(loc.connectionId)?.name ?? 'Remote';
      return loc.path === '/' ? name : loc.path.slice(loc.path.lastIndexOf('/') + 1);
    }
    case 'tool':
      return ({ storage: 'Storage', duplicates: 'Duplicates', compare: 'Compare', sync: 'Synchronize', operations: 'Operations', downloads: 'Downloads', media: 'Media', rules: 'Rules', settings: 'Settings', integrations: 'Integrations', projects: 'Projects', customize: 'Customization', trash: 'Trash', findReplace: 'Find and replace', shares: 'Network shares', timeline: 'Recent changes', backups: 'Backups', s3: 'S3 Storage', batchRename: 'Batch Rename', checksum: 'Checksum', diskUsage: 'Disk Usage', imageTools: 'Bulk Image Tools', hexEditor: 'Hex Editor', contentSearch: 'Content Search', symlinks: 'Symbolic Links', batchDate: 'Batch Date Modifier', transfers: 'Transfer Queue', pdfTools: 'PDF Tools', snippets: 'Snippet Library', conversionPipeline: 'Conversion Pipeline', volumes: 'Mounted Volumes', recycleBin: 'Recycle Bin', git: 'Git', hashCompare: 'Hash Comparator', recentFiles: 'Recent Files', cloudMount: 'Cloud Storage', archiveManager: 'Archive Manager', macros: 'Macro Recorder', folderWatch: 'Folder Watcher', fileVersions: 'File Versions', universeExplorer: 'Universe Explorer', folderDiff: 'Folder Diff', changeObservatory: 'Change Observatory', impactSimulator: 'Impact Simulator', universeObservatory: 'Universe Observatory', shortcutReference: 'Keyboard Shortcuts', quickNotes: 'Quick Notes', systemInfo: 'System Information', spaceCleaner: 'Space Cleaner', textDiff: 'Text Diff', colorPicker: 'Color Picker', qrGenerator: 'QR Code Generator', workspaceSessions: 'Workspace Sessions', tagManager: 'Tag Manager' } as const)[loc.tool];
  }
}

export function locationIcon(loc: Location): string {
  switch (loc.kind) {
    case 'home': return 'home';
    case 'fs': return 'folder';
    case 'search': case 'savedSearch': return 'search';
    case 'collection': return 'collection';
    case 'archive': return 'archive';
    case 'library': return loc.category === 'generated' ? 'sparkle' : loc.category === 'recent' ? 'clock' : loc.category.startsWith('provider:') ? 'plug' : 'tag';
    case 'project': return 'project';
    case 'editor': return 'edit';
    case 'remote': return 'server';
    case 'tool': return ({ storage: 'storage', duplicates: 'duplicates', compare: 'compare', sync: 'sync', operations: 'activity', downloads: 'download', media: 'media', rules: 'rules', settings: 'settings', integrations: 'plug', projects: 'project', customize: 'palette', trash: 'trash', findReplace: 'replace', shares: 'share', timeline: 'timeline', backups: 'backup', s3: 'cloud', batchRename: 'bulkRename', checksum: 'verify', diskUsage: 'pieChart', imageTools: 'image', hexEditor: 'binary', contentSearch: 'search', symlinks: 'link', batchDate: 'clock', transfers: 'activity', pdfTools: 'file', snippets: 'code', conversionPipeline: 'convert', volumes: 'storage', recycleBin: 'trash', git: 'gitBranch', hashCompare: 'verify', recentFiles: 'clock', cloudMount: 'cloud', archiveManager: 'archive', macros: 'activity', folderWatch: 'eye', fileVersions: 'clock', universeExplorer: 'globe', folderDiff: 'compare', changeObservatory: 'activity', impactSimulator: 'alertTriangle', universeObservatory: 'globe', shortcutReference: 'keyboard', quickNotes: 'edit', systemInfo: 'cpu', spaceCleaner: 'cleanup', textDiff: 'diff', colorPicker: 'palette', qrGenerator: 'link', workspaceSessions: 'workspace', tagManager: 'tag' } as const)[loc.tool];
  }
}

export function TitleBar({ showTabs = true }: { showTabs?: boolean }) {
  const win = useStore(app, (s) => s.windowState);
  const isMac = win.platform === 'darwin';
  return (
    <header className={`titlebar ${isMac ? 'mac' : ''} ${win.focused ? '' : 'blurred'}`}>
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
          <ellipse cx="12" cy="12" rx="11" ry="4.2" fill="none" stroke="var(--text-2)" strokeWidth="1.2" transform="rotate(-24 12 12)" />
          <circle cx="12" cy="12" r="2.4" fill="var(--accent)" />
        </svg>
        <h1 className="brand-name">Orbis Files</h1>
      </div>
      {showTabs ? <TabStrip /> : <div className="tabstrip tabstrip-hidden"><span className="muted small">{locationTitle(currentLocation(activePane()))}</span></div>}
      <div className="titlebar-actions no-drag">
        <SpaceSwitcher />
        <WorkspaceSwitcher />
        <IconButton icon="command" label="Command palette" shortcut={shortcutFor('app.palette')} onClick={() => void runCommand('app.palette')} />
      </div>
      {!isMac && (
        <div className="win-controls no-drag">
          <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void call('win:minimize')}><Icon name="winMin" size={14} /></button>
          <button type="button" aria-label={win.maximized ? 'Restore' : 'Maximize'} title={win.maximized ? 'Restore' : 'Maximize'} onClick={() => void call('win:toggleMaximize')}>
            <Icon name={win.maximized ? 'winRestore' : 'winMax'} size={12} />
          </button>
          <button type="button" className="close" aria-label="Close window" title="Close" onClick={() => void call('win:close')}><Icon name="close" size={15} /></button>
        </div>
      )}
    </header>
  );
}

function TabStrip() {
  const { tabs, activeTabId, groups } = useStore(ws, (s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, groups: s.groups }));
  useStore(app, (s) => [s.collections, s.savedSearches]);
  // Panes with unsaved editor changes (a dot on their tab).
  const dirtyKey = useStore(editorUi, (s) => Object.values(s).filter((u) => u.dirty).map((u) => u.paneId).join('|'));
  const dirtyPanes = new Set(dirtyKey ? dirtyKey.split('|') : []);
  const menu = useMenu();
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabEl = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`) ?? null;
  // The active tab is always scrolled into view when the tabs do not all fit.
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = tabEl(activeTabId);
    if (!list || !el) return;
    const reveal = () => {
      if (el.offsetLeft < list.scrollLeft) list.scrollLeft = el.offsetLeft - 3;
      else if (el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = el.offsetLeft + el.offsetWidth - list.clientWidth + 3;
    };
    reveal();
    // Also when the strip or the tab changes size (window resized, tabs added or renamed).
    const ro = new ResizeObserver(reveal);
    ro.observe(list);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTabId, tabs.length]);
  // Arrow keys move between tabs (automatic activation); focus follows the active tab.
  const focusTab = (id: string) => {
    activateTab(id);
    requestAnimationFrame(() => tabEl(id)?.focus());
  };

  const tabMenu = (t: Tab): MenuItem[] => [
    { label: 'New tab', icon: 'plus', run: () => openTab(currentLocation(t.panes[0]!), { after: t.id }) },
    { label: 'Duplicate tab', icon: 'duplicate', run: () => duplicateTab(t.id) },
    { label: t.pinned ? 'Unpin tab' : 'Pin tab', icon: t.pinned ? 'unpin' : 'pin', run: () => togglePinTab(t.id) },
    SEP,
    {
      label: 'Add to group',
      icon: 'collection',
      submenu: [
        { label: 'New group…', run: async () => {
          const name = await prompt({ title: 'New tab group', label: 'Group name', initial: 'Group', confirmLabel: 'Create' });
          if (name) createGroup([t.id], name);
        } },
        ...groups.map((g) => ({ label: g.name, checked: t.groupId === g.id, run: () => setTabGroup(t.id, g.id) })),
        ...(t.groupId ? [SEP, { label: 'Remove from group', run: () => setTabGroup(t.id, undefined) }] : []),
      ],
    },
    SEP,
    { label: 'Close tab', icon: 'close', shortcut: shortcutFor('nav.closeTab'), run: () => closeTab(t.id) },
    { label: 'Close other tabs', run: () => closeOtherTabs(t.id), disabled: tabs.length < 2 },
    { label: 'Close tabs to the right', run: () => closeTabsToRight(t.id), disabled: tabs[tabs.length - 1]?.id === t.id },
  ];

  const groupMenu = (gid: string): MenuItem[] => {
    const g = groups.find((x) => x.id === gid)!;
    return [
      { label: g.collapsed ? 'Expand group' : 'Collapse group', run: () => toggleGroup(gid) },
      { label: 'Rename group…', run: async () => {
        const name = await prompt({ title: 'Rename group', label: 'Group name', initial: g.name, confirmLabel: 'Rename' });
        if (name) renameGroup(gid, name);
      } },
      { label: 'Move group left', run: () => moveGroup(gid, -1) },
      { label: 'Move group right', run: () => moveGroup(gid, 1) },
      { label: 'Ungroup', run: () => ungroup(gid) },
      { label: 'Close group', danger: true, run: () => tabs.filter((t) => t.groupId === gid).forEach((t) => closeTab(t.id)) },
    ];
  };

  const rendered: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  tabs.forEach((t, i) => {
    const g = t.groupId ? groups.find((x) => x.id === t.groupId) : undefined;
    if (g && g.id !== lastGroup) {
      rendered.push(
        <button key={`g-${g.id}`} type="button" role="tab" aria-selected={false} className={`tab-group-chip no-drag ${g.collapsed ? 'collapsed' : ''}`} style={{ '--group': g.color } as React.CSSProperties}
          onClick={() => toggleGroup(g.id)} onContextMenu={(e) => { e.preventDefault(); menu.open(groupMenu(g.id), e.clientX, e.clientY); }}
          aria-expanded={!g.collapsed} title={`${g.name} — click to ${g.collapsed ? 'expand' : 'collapse'}`}>
          {g.name}
        </button>,
      );
    }
    lastGroup = g?.id;
    if (g?.collapsed && t.id !== activeTabId) return;
    const pane = t.panes[t.activePane] ?? t.panes[0]!;
    const loc = currentLocation(pane);
    rendered.push(
      <div
        key={t.id}
        data-tab-id={t.id}
        role="tab"
        aria-selected={t.id === activeTabId}
        tabIndex={t.id === activeTabId ? 0 : -1}
        className={`tab no-drag ${t.id === activeTabId ? 'is-active' : ''} ${t.pinned ? 'is-pinned' : ''} ${dragId === t.id ? 'is-dragging' : ''}`}
        style={g ? ({ '--group': g.color } as React.CSSProperties) : undefined}
        title={loc.kind === 'fs' ? loc.path : locationTitle(loc)}
        draggable
        onDragStart={(e) => {
          setDragId(t.id);
          e.dataTransfer.setData('application/x-orbis-tab', t.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-orbis-tab')) e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/x-orbis-tab');
          if (id && id !== t.id) moveTab(id, i);
        }}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(t.id);
          }
        }}
        onClick={() => activateTab(t.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          menu.open(tabMenu(t), e.clientX, e.clientY);
        }}
        aria-keyshortcuts="Control+W"
        onKeyDown={(e) => {
          if (e.key === 'Delete') closeTab(t.id);
          const target = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : undefined;
          if (target) {
            e.preventDefault();
            focusTab(target.id);
          }
        }}
      >
        <Icon name={t.pinned ? 'pin' : locationIcon(loc)} size={13} />
        {!t.pinned && <span className="tab-title">{locationTitle(loc)}</span>}
        {t.panes.some((p) => dirtyPanes.has(p.id)) && <span className="tab-dirty" title="Unsaved changes"><span className="sr-only">, unsaved changes</span></span>}
        {!t.pinned && isSplit(t) && <span className="tab-split" title={`${paneCount(t)} panes`}><Icon name="split" size={12} /></span>}
        {!t.pinned && (
          // Mouse affordance only: keyboard users close tabs with Ctrl+W or the tab's context menu,
          // so the tab itself is the single focus stop (no interactive control nested in a tab).
          <span className="tab-close" aria-hidden title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
            <Icon name="close" size={12} />
          </span>
        )}
      </div>,
    );
  });

  return (
    <div className="tabstrip">
      <div className="tablist" role="tablist" aria-label="Tabs" ref={listRef}>{rendered}</div>
      <IconButton className="no-drag tab-new" icon="plus" label="New tab" shortcut={shortcutFor('nav.newTab')} onClick={() => void runCommand('nav.newTab')} />
      {menu.node}
    </div>
  );
}

export function StatusBar({ count, selected, selectedBytes, loading, watching, note, extra }: { count?: number; selected: number; selectedBytes?: number; loading?: boolean; watching?: boolean; note?: string; extra?: React.ReactNode }) {
  const active = useStore(app, (s) => opsActive(s));
  const bg = useStore(jobs, (s) => ({ n: s.list.length, paused: s.list.filter((j) => s.controls[j.id]?.paused).length, indexing: s.index?.state === 'scanning', scanned: s.index?.scanned ?? 0 }));
  const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
  const running = active.find((o) => o.state === 'running');
  const sharing = useStore(shares, (s) => s.list.filter((x) => x.state === 'running').length);
  const pct = running?.progress.totalBytes ? running.progress.completedBytes / running.progress.totalBytes : undefined;
  return (
    <footer className="statusbar" aria-live="polite">
      <span className="tabular status-count">{count === undefined ? '' : `${count.toLocaleString()} item${count === 1 ? '' : 's'}`}{loading ? ' · loading…' : ''}</span>
      {selected > 0 && <span className="tabular">{selected.toLocaleString()} selected{selectedBytes !== undefined ? ` · ${formatBytes(selectedBytes)}` : ''}</span>}
      {note && <span className="muted">{note}</span>}
      {extra}
      <span className="spacer" />
      {watching === false && <span className="muted" title="This location cannot be watched for changes. Use Refresh (F5).">Not watching for changes</span>}
      {bg.indexing && <span className="muted tabular" title="The search index is being updated. Searches still work and re-check every result on disk.">Indexing · {bg.scanned.toLocaleString()}</span>}
      {sharing > 0 && <button type="button" className="status-ops status-share" onClick={() => void runCommand('tools.shares')} title="Files are shared on the local network. Open Network shares to see the link or stop sharing."><Icon name="share" size={13} /><span>Sharing on network{sharing > 1 ? ` (${sharing})` : ''}</span></button>}
      <AutomationIndicator />
      <BackupIndicator />
      {bg.n > 0 && <button type="button" className="status-ops busy" onClick={() => void runCommand('app.operations')} title="Background tasks">{bg.n} background task{bg.n === 1 ? '' : 's'}{bg.paused ? ` · ${bg.paused} paused` : ''}</button>}
      <button type="button" className={`status-ops ${active.length ? 'busy' : ''}`} onClick={() => void runCommand('app.operations')} title="Operations" aria-label={active.length ? undefined : 'Operations: none active'}>
        <Icon name="activity" size={13} />
        {active.length ? (
          <span className="tabular">
            {active.length} running{running ? ` · ${running.progress.currentItem ?? ''}` : ''}
            {pct !== undefined ? ` · ${Math.round(pct * 100)}%` : ''}
            {active.some((o) => o.state === 'awaiting_conflict') ? ' · needs your decision' : ''}
          </span>
        ) : (
          <span className="status-ops-idle">No active operations</span>
        )}
      </button>
    </footer>
  );
}

/**
 * A backup running (manual or scheduled) in the status bar, with its progress;
 * "Schedules paused" when the user paused them and any task is scheduled.
 * Click → the Backups view.
 */
function BackupIndicator() {
  const running = useStore(app, (s) => Object.values(s.ops).filter((o) => o.type === 'backup' && !TERMINAL_STATES.has(o.state)));
  const sched = useStore(schedules, (s) => s.status);
  const first = running[0];
  if (first) {
    const p = first.progress;
    const pct = p.totalBytes ? p.completedBytes / p.totalBytes : p.totalItems ? p.completedItems / p.totalItems : undefined;
    const label = `Backing up${running.length > 1 ? ` (${running.length})` : ''}${first.state === 'paused' ? ' · paused' : pct !== undefined ? ` · ${Math.min(100, Math.round(pct * 100))}%` : ' · reading folders'}`;
    return (
      <button type="button" className="status-ops status-backup is-running" title="A backup is running. Open Backups for details." onClick={() => void runCommand('tools.backups')}>
        <Icon name="backup" size={13} /><span className="tabular">{label}</span>
      </button>
    );
  }
  if (sched?.paused && sched.tasks.length) {
    return (
      <button type="button" className="status-ops status-backup is-paused" title="Scheduled backups and synchronizations do not start until you resume them." onClick={() => void runCommand('tools.backups')}>
        <Icon name="scheduleOff" size={13} /><span>Schedules paused</span>
      </button>
    );
  }
  return null;
}

/**
 * Rule automation state in the status bar: shown once any rule runs on new
 * files. Click → the rules view (activity, pause). Paused is shown as such.
 */
function AutomationIndicator() {
  const st = useStore(automation, (s) => s.status);
  if (!st || !st.rules.length) return null;
  const active = st.rules.filter((r) => r.active).length;
  const label = st.paused ? 'Automation paused' : active ? `Automation on · ${active} rule${active === 1 ? '' : 's'}${st.throttled ? ' · at limit' : ''}` : 'Automation waiting';
  const tip = st.paused
    ? 'Organising rules do not run on new files until you resume (Resume automation).'
    : active
      ? `Watching ${st.watching.length} folder${st.watching.length === 1 ? '' : 's'} for new files while Orbis Files is open.`
      : 'Rules set to run automatically cannot run yet: open Organising rules for the reason.';
  return (
    <button type="button" className={`status-ops status-automation ${st.paused ? 'is-paused' : active ? 'is-on' : ''}`} title={tip} onClick={() => void runCommand('tools.rules')}>
      <Icon name={st.paused ? 'automationOff' : 'automation'} size={13} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Active workspace and quick switching. A workspace is a named set of
 * interface preferences (layout, views, toolbar, navigation); switching never
 * moves, copies or changes files and keeps the folders that are open.
 */
function WorkspaceSwitcher() {
  const st = useStore(custom, (s) => ({ list: s.server.config.workspaces, active: s.server.config.activeWorkspaceId }));
  const menu = useMenu();
  const current = st.list.find((w) => w.id === st.active) ?? st.list[0];
  const items = (): MenuItem[] => [
    ...st.list.map((w) => ({ label: w.name, checked: w.id === st.active, run: () => void applyCustom({ op: 'activateWorkspace', id: w.id }) })),
    SEP,
    { label: 'New workspace…', icon: 'plus', run: async () => {
      const name = await prompt({ title: 'New workspace', label: 'Name (starts from the current layout and views)', initial: 'My workspace', confirmLabel: 'Create' });
      if (name) await applyCustom({ op: 'createWorkspace', name, fromCurrent: true });
    } },
    { label: 'Manage workspaces…', icon: 'workspace', run: () => openStudio('workspaces') },
  ];
  return (
    <>
      <button type="button" className="ws-switch no-drag" aria-haspopup="menu" aria-label={`Workspace: ${current?.name ?? ''}. Change workspace`} data-tip="Workspace (changes the interface only)"
        onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); menu.open(items(), r.right, r.bottom + 4, 'right'); }}>
        <Icon name="workspace" size={14} />
        <span className="ws-name">{current?.name}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {menu.node}
    </>
  );
}
