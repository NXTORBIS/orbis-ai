import React, { useEffect, useState } from 'react';
import { app, confirm, openDialog, prompt, toast, toastError } from '../state/app';
import { useStore } from '../state/store';
import { activePane, currentLocation, navigate, openTab, ws } from '../state/workspace';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { SEP, useMenu, type MenuItem } from '../ui/components';
import { useCustom } from '../state/custom';
import { openStudio } from './studio/studioState';
import { SIDEBAR_SECTIONS } from '../../shared/customization/schema';
import { dropOnto, openRemote } from '../actions';
import { remote } from '../state/remote';
import { remoteProtocolLabel, remoteRef } from '../../shared/remote';
import { formatBytes } from '../ui/format';
import { locationKey, type Location } from '../../shared/model';
import { readDragPaths, dropEffectFor } from './dnd';

const KNOWN_ICON: Record<string, string> = { home: 'home', desktop: 'drive', documents: 'fileText', downloads: 'download', pictures: 'image', videos: 'fileVideo', music: 'music' };

type PathState = { exists: boolean; reason?: 'missing' | 'permission' | 'unavailable' };

/**
 * Existence of saved locations (pins and standard folders), checked when the
 * sidebar appears, when drives change and every half minute. A location that
 * disappears is shown with a recovery state; it is never silently replaced.
 */
function useLocationStates(paths: string[], volumesKey: string): Record<string, PathState> {
  const [states, setStates] = useState<Record<string, PathState>>({});
  const key = paths.join('\n');
  useEffect(() => {
    let live = true;
    const check = () => {
      if (!paths.length) return;
      void call<Array<{ path: string; exists: boolean; reason?: PathState['reason'] }>>('fs:checkPaths', { paths: paths.slice(0, 500) }).then((r) => {
        if (live) setStates(Object.fromEntries(r.map((x) => [x.path, { exists: x.exists, reason: x.reason }])));
      }, () => undefined);
    };
    check();
    const t = setInterval(check, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, volumesKey]);
  return states;
}

export function Sidebar() {
  const s = useStore(app, (x) => ({ known: x.known, pins: x.pins, volumes: x.volumes, collections: x.collections, saved: x.savedSearches, tags: x.tags, smartFolders: x.smartFolders, sidebar: x.sidebar, recents: x.recents, projects: x.projects, providers: x.providers }));
  const current = useStore(ws, () => locationKey(currentLocation(activePane())));
  const remoteConns = useStore(remote, (r) => r.connections);
  const nav = useCustom((r) => r.navigation);
  const menu = useMenu();
  const states = useLocationStates([...s.known.map((k) => k.path), ...s.pins.map((p) => p.path)], s.volumes.map((v) => v.mountPath).join('|'));

  const toggle = (id: string) => {
    const next = { ...s.sidebar, collapsed: { ...s.sidebar.collapsed, [id]: !s.sidebar.collapsed[id] } };
    app.set({ sidebar: next });
    void call('cat:setSidebar', next);
  };
  const go = (loc: Location, e?: React.MouseEvent) => {
    if (e && (e.ctrlKey || e.metaKey || e.button === 1)) openTab(loc, { activate: false });
    else void navigate(activePane().id, loc);
  };

  const recovery = (path: string, st: PathState, pinned: boolean): MenuItem[] => {
    const onDrive = s.volumes.some((v) => path === v.mountPath || path.startsWith(v.mountPath.endsWith('/') ? v.mountPath : `${v.mountPath}/`));
    const why = st.reason === 'permission' ? 'You do not have permission to open it.' : st.reason === 'unavailable' ? 'Its drive or network location is not responding.' : !onDrive && s.volumes.length ? 'Its drive is not connected.' : 'It was moved, renamed or deleted.';
    return [
      { label: why, disabled: true, reason: path },
      SEP,
      { label: 'Try again', icon: 'refresh', run: () => void call<Array<{ exists: boolean }>>('fs:checkPaths', { paths: [path] }).then((r) => (r[0]?.exists ? go({ kind: 'fs', path }) : toast({ level: 'warning', title: 'Still not available', detail: path })), toastError) },
      ...(pinned ? [
        { label: 'Locate the folder…', icon: 'folderOpen', run: async () => {
          const dir = await call<string | null>('fs:pickDirectory', { title: `Where is “${path.split(/[\\/]/).filter(Boolean).pop() ?? path}” now?` });
          if (!dir) return;
          await call('cat:pin', { path: dir }).catch(toastError);
          await call('cat:unpin', { path }).catch(toastError);
          toast({ level: 'success', title: 'Pin updated', detail: dir });
        } },
        { label: 'Remove from sidebar', icon: 'unpin', run: () => void call('cat:unpin', { path }).catch(toastError) },
      ] : []),
    ];
  };

  const fsItem = (path: string, label: string, icon: string, extra?: React.ReactNode, ctx?: MenuItem[], pinned = false) => {
    const st = states[path];
    const missing = st && !st.exists;
    return (
      <SidebarItem
        key={path}
        label={label}
        icon={missing ? 'removeLocation' : icon}
        title={missing ? `${path} — not available (click for options)` : path}
        active={current === `fs:${path}`}
        unavailable={missing}
        dropPath={missing ? undefined : path}
        onClick={(e) => (missing ? menu.open(recovery(path, st, pinned), e.clientX, e.clientY) : go({ kind: 'fs', path }, e))}
        onContext={(e) => menu.open(missing ? recovery(path, st, pinned) : [{ label: 'Open in new tab', icon: 'tab', run: () => openTab({ kind: 'fs', path }) }, { label: 'Open in new window', icon: 'window', run: () => void call('win:new', { path }) }, ...(ctx ?? [])], e.clientX, e.clientY)}
        extra={extra}
      />
    );
  };

  const counts = nav.indicators.counts;
  const visibleIds = (() => {
    const listed = nav.sections.map((x) => x.id);
    // Sections this configuration does not mention (added in a newer version) are shown at the end.
    return [...nav.sections.filter((x) => x.visible).map((x) => x.id), ...SIDEBAR_SECTIONS.filter((id) => !listed.includes(id))];
  })();

 const sections: Record<string, React.ReactNode> = {
      quick: (
      <Section key="quick" id="quick" title="Quick access" collapsed={s.sidebar.collapsed.quick} onToggle={toggle}>
        {s.known.filter((k) => k.id !== 'home').map((k) => fsItem(k.path, k.label, KNOWN_ICON[k.id] ?? 'folder'))}
 {s.known.length <= 1 && <p className="sidebar-note">No standard folders were found on this system.</p>}
      </Section>),
      pinned: (
      <Section key="pinned" id="pinned" title="Pinned" collapsed={s.sidebar.collapsed.pinned} onToggle={toggle} empty={!s.pins.length ? 'Pin folders with right-click → Pin to sidebar.' : undefined}>
 {s.pins.map((p) =>
          fsItem(p.path, p.label ?? p.path.split(/[\\/]/).filter(Boolean).pop() ?? p.path, 'pin', undefined, [
            { label: 'Unpin', icon: 'unpin', run: () => void call('cat:unpin', { path: p.path }).catch(toastError) },
          ], true),
        )}
      </Section>),
      drives: (
      <Section key="drives" id="drives" title="Drives" collapsed={s.sidebar.collapsed.drives} onToggle={toggle}>
        {s.volumes.map((v) =>
          fsItem(v.mountPath, v.label, v.removable ? 'usb' : v.fsType && /nfs|cifs|smb|sshfs|rclone/.test(v.fsType) ? 'network' : 'drive',
            nav.indicators.driveUsage && v.totalBytes ? (
              <span className="drive-meter" title={`${formatBytes(v.freeBytes)} free of ${formatBytes(v.totalBytes)}${v.fsType ? ` · ${v.fsType}` : ''}`}>
                <span style={{ width: `${Math.round(((v.totalBytes - (v.freeBytes ?? 0)) / v.totalBytes) * 100)}%` }} />
              </span>
            ) : undefined,
          ),
        )}
        {!s.volumes.length && <p className="sidebar-note">Drive information is not available.</p>}
      </Section>),
      remote: (
      <Section key="remote" id="remote" title="Remote" collapsed={s.sidebar.collapsed.remote} onToggle={toggle}
        action={{ label: 'Add remote connection', run: () => openDialog('remoteEdit', {}) }}
        empty={!remoteConns.length ? 'Browse SFTP, WebDAV and FTP servers: add one with +.' : undefined}>
        {remoteConns.map((c) => (
          <SidebarItem
            key={c.id}
            label={c.name}
            icon={c.connected ? 'server' : 'serverOff'}
            title={`${remoteProtocolLabel(c)} · ${c.username}@${c.host}:${c.port} · ${c.connected ? 'connected' : 'not connected'}`}
            active={current.startsWith(`remote:${c.id}:`)}
            dropPath={c.connected && c.startPath ? remoteRef(c.id, c.startPath) : undefined}
            onClick={(e) => void openRemote(c.id, { tab: e.ctrlKey || e.metaKey || e.button === 1 })}
            onContext={(e) => menu.open([
              { label: 'Open', icon: 'folderOpen', run: () => void openRemote(c.id) },
              { label: 'Open in new tab', icon: 'tab', run: () => void openRemote(c.id, { tab: true }) },
              SEP,
              { label: 'Edit connection…', icon: 'rename', run: () => openDialog('remoteEdit', { id: c.id }) },
              { label: 'Disconnect', icon: 'unplug', disabled: !c.connected, reason: 'Not connected.', run: () => void call('remote:disconnect', { id: c.id, forgetPassword: true }).catch(toastError) },
              { label: 'Remote connections…', icon: 'server', run: () => openDialog('remoteConnections') },
              SEP,
              { label: 'Remove connection…', icon: 'trash', danger: true, run: async () => {
                if (await confirm({ title: `Remove “${c.name}”?`, body: 'The connection and its saved password are removed from Orbis Files. Nothing on the server is changed.', confirmLabel: 'Remove connection', destructive: true })) await call('remote:remove', { id: c.id }).catch(toastError);
              } },
            ], e.clientX, e.clientY)}
          />
        ))}
      </Section>),
      library: (
      <Section key="library" id="library" title="Library" collapsed={s.sidebar.collapsed.library} onToggle={toggle}>
        <SidebarItem label="Downloads" icon="download" active={current === 'tool:downloads'} onClick={(e) => go({ kind: 'tool', tool: 'downloads' }, e)} />
        <SidebarItem label="AI-generated" icon="sparkle" active={current === 'library:generated'} onClick={(e) => go({ kind: 'library', category: 'generated' }, e)} />
        <SidebarItem label="Media" icon="media" active={current === 'tool:media'} onClick={(e) => go({ kind: 'tool', tool: 'media' }, e)} />
        <SidebarItem label="Recent" icon="clock" active={current === 'library:recent'} onClick={(e) => go({ kind: 'library', category: 'recent' }, e)} />
        <SidebarItem label="Recent changes" icon="timeline" active={current === 'tool:timeline'} onClick={(e) => go({ kind: 'tool', tool: 'timeline' }, e)} />
        <SidebarItem label="Trash" icon="trash" active={current === 'tool:trash'} onClick={(e) => go({ kind: 'tool', tool: 'trash' }, e)} />
        <SidebarItem label="Projects" icon="project" count={counts ? s.projects.length || undefined : undefined} active={current === 'tool:projects' || current.startsWith('project:')} onClick={(e) => go({ kind: 'tool', tool: 'projects' }, e)} />
        <SidebarItem label="Imported" icon="import" onClick={(e) => void call<string>('lib:importFolder').then(async (dir) => {
          const st = await call('fs:stat', { path: dir }).catch(() => null);
          if (st) go({ kind: 'fs', path: dir }, e);
          else toast({ level: 'info', title: 'Nothing has been imported yet', detail: `Use right-click → Import a copy. Copies go to ${dir}.` });
        }, toastError)} />
        {s.providers.filter((p) => !p.builtIn && p.availability !== 'not_connected').map((p) => (
          <SidebarItem key={p.id} label={p.label} icon="plug" title={p.availability === 'error' ? p.note : `Provided by the Orbis app · ${p.types.join(', ').replace(/_/g, ' ')}`}
            active={current === `library:provider:${p.id}`} onClick={(e) => go({ kind: 'library', category: `provider:${p.id}` }, e)} />
        ))}
      </Section>),
      collections: (
      <Section
        key="collections"
        id="collections"
        title="Collections"
        collapsed={s.sidebar.collapsed.collections}
        onToggle={toggle}
        action={{ label: 'New collection', run: async () => {
          const name = await prompt({ title: 'New collection', label: 'Name', initial: 'New collection', confirmLabel: 'Create' });
          if (name) await call('cat:createCollection', { name }).catch(toastError);
        } }}
        empty={!s.collections.length ? 'Collections group files without copying them.' : undefined}
      >
        {s.collections.map((c) => (
          <SidebarItem
            key={c.id}
            label={c.name}
            icon="collection"
            count={counts ? c.count : undefined}
            active={current === `collection:${c.id}`}
            dropCollection={c.id}
            onClick={(e) => go({ kind: 'collection', id: c.id }, e)}
            onContext={(e) => menu.open([
              { label: 'Rename…', icon: 'rename', run: async () => {
                const name = await prompt({ title: 'Rename collection', label: 'Name', initial: c.name, confirmLabel: 'Rename' });
                if (name) await call('cat:renameCollection', { id: c.id, name }).catch(toastError);
              } },
              { label: 'Delete collection…', icon: 'trash', danger: true, run: async () => {
                if (await confirm({ title: `Delete "${c.name}"?`, body: 'Only the collection is removed. The files it references are not touched.', confirmLabel: 'Delete collection' })) await call('cat:deleteCollection', { id: c.id }).catch(toastError);
              } },
            ], e.clientX, e.clientY)}
          />
        ))}
      </Section>),
      searches: (
      <Section key="searches" id="searches" title="Saved searches" collapsed={s.sidebar.collapsed.searches} onToggle={toggle} empty={!s.saved.length ? 'Save a search from its results view.' : undefined}>
        {s.saved.map((q) => (
          <SidebarItem key={q.id} label={q.name} icon="search" title={q.query} active={current === `savedSearch:${q.id}`} onClick={(e) => go({ kind: 'savedSearch', id: q.id }, e)}
            onContext={(e) => menu.open([{ label: 'Delete saved search', icon: 'trash', danger: true, run: () => void call('cat:deleteSavedSearch', { id: q.id }).catch(toastError) }], e.clientX, e.clientY)} />
        ))}
      </Section>),
      tags: (
      <Section key="tags" id="tags" title="Tags" collapsed={s.sidebar.collapsed.tags} onToggle={toggle} empty={!s.tags.length ? 'Tag items with right-click → Tags.' : undefined}>
        {s.tags.map((t) => (
          <SidebarItem key={t.id} label={t.name} icon="tag" count={counts ? t.count : undefined} iconColor={t.color ?? undefined} active={current === `library:tag:${t.id}`}
            onClick={(e) => go({ kind: 'library', category: `tag:${t.id}` }, e)}
            onContext={(e) => menu.open([
              { label: 'Rename tag…', icon: 'rename', run: async () => {
                const name = await prompt({ title: 'Rename tag', label: 'Name', initial: t.name, confirmLabel: 'Rename' });
                if (name) await call('cat:renameTag', { id: t.id, name }).catch(toastError);
              } },
              { label: 'Delete tag…', icon: 'trash', danger: true, run: async () => {
                if (await confirm({ title: `Delete tag "${t.name}"?`, body: `It is removed from ${t.count} item${t.count === 1 ? '' : 's'}. The files are not touched.`, confirmLabel: 'Delete tag' })) await call('cat:deleteTag', { id: t.id }).catch(toastError);
              } },
            ], e.clientX, e.clientY)} />
        ))}
      </Section>),
      smartFolders: (
      <Section key="smartFolders" id="smartFolders" title="Smart folders" collapsed={s.sidebar.collapsed.smartFolders} onToggle={toggle} empty={!s.smartFolders.length ? 'Create a smart folder from the command palette.' : undefined}>
        {s.smartFolders.map((sf) => (
          <SidebarItem key={sf.id} label={sf.name} icon="search" iconColor={sf.color ?? undefined} active={false}
            onClick={() => void call<Array<{ path: string; kind: string }>>('cat:querySmartFolder', { query: sf.query }).then((items) => {
              if (!items.length) { toast({ level: 'info', title: `No items match "${sf.name}"` }); return; }
              navigate(activePane().id, { kind: 'search', query: `smart:${sf.id}`, scope: [] });
            }, toastError)}
            onContext={(e) => menu.open([
              { label: 'Delete smart folder…', icon: 'trash', danger: true, run: async () => {
                if (await confirm({ title: `Delete smart folder "${sf.name}"?`, body: 'No files are affected.', confirmLabel: 'Delete' })) await call('cat:deleteSmartFolder', { id: sf.id }).catch(toastError);
              } },
            ], e.clientX, e.clientY)} />
        ))}
      </Section>),
      tools: (
      <Section key="tools" id="tools" title="Tools" collapsed={s.sidebar.collapsed.tools} onToggle={toggle}>
        {([['storage', 'Storage', 'storage'], ['duplicates', 'Duplicates', 'duplicates'], ['compare', 'Compare', 'compare'], ['sync', 'Synchronize', 'sync'], ['backups', 'Backups', 'backup'], ['findReplace', 'Find & replace', 'replace'], ['rules', 'Rules', 'rules'], ['integrations', 'Integrations', 'plug']] as const).map(([tool, label, icon]) => (
          <SidebarItem key={tool} label={label} icon={icon} active={current === `tool:${tool}`} onClick={(e) => go({ kind: 'tool', tool }, e)} />
        ))}
      </Section>),
      universe: (
      <Section key="universe" id="universe" title="Universe" collapsed={s.sidebar.collapsed.universe} onToggle={toggle}>
        {([['universeExplorer', 'Explorer', 'globe'], ['folderDiff', 'Folder Diff', 'compare'], ['changeObservatory', 'Change Observatory', 'activity'], ['impactSimulator', 'Impact Simulator', 'alertTriangle'], ['universeObservatory', 'Observatory', 'globe']] as const).map(([tool, label, icon]) => (
          <SidebarItem key={tool} label={label} icon={icon} active={current === `tool:${tool}`} onClick={(e) => go({ kind: 'tool', tool }, e)} />
        ))}
      </Section>),
    };

  return (
    <nav className="sidebar" aria-label="Places" data-density={nav.density} onContextMenu={(e) => {
      if ((e.target as HTMLElement).closest('.sidebar-item')) return;
      e.preventDefault();
      menu.open([{ label: 'Customize sidebar…', icon: 'palette', run: () => openStudio('navigation') }], e.clientX, e.clientY);
    }}>
      <SidebarItem label="Home" icon="home" active={current === 'home'} onClick={(e) => go({ kind: 'home' }, e)} />
      {visibleIds.filter((id) => id !== 'remote').map((id) => sections[id])}
      {menu.node}
    </nav>
  );
}

function Section({ id, title, collapsed, onToggle, children, empty, action }: { id: string; title: string; collapsed?: boolean; onToggle: (id: string) => void; children?: React.ReactNode; empty?: string; action?: { label: string; run: () => void } }) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-heading">
        <button type="button" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
          <span>{title}</span>
        </button>
        {action && (
          <button type="button" className="sidebar-add" aria-label={action.label} title={action.label} onClick={action.run}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="sidebar-items">
          {children}
          {empty && <p className="sidebar-note">{empty}</p>}
        </div>
      )}
    </section>
  );
}

function SidebarItem({ label, icon, active, onClick, onContext, title, extra, count, dropPath, dropCollection, iconColor, unavailable }: {
  label: string; icon: string; active?: boolean; onClick: (e: React.MouseEvent) => void; onContext?: (e: React.MouseEvent) => void; title?: string;
  extra?: React.ReactNode; count?: number; dropPath?: string; dropCollection?: string; iconColor?: string; unavailable?: boolean;
}) {
  const [over, setOver] = useState<string | null>(null);
  const droppable = !!dropPath || !!dropCollection;
  return (
    <button
      type="button"
      className={`sidebar-item ${active ? 'is-active' : ''} ${over ? 'is-drop' : ''} ${unavailable ? 'is-unavailable' : ''}`}
      aria-description={unavailable ? 'Not available' : undefined}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onAuxClick={(e) => e.button === 1 && onClick(e)}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          onContext(e);
        }
      }}
      onDragOver={(e) => {
        if (!droppable) return;
        const paths = e.dataTransfer.types.includes('application/x-orbis-paths') || e.dataTransfer.types.includes('Files');
        if (!paths) return;
        e.preventDefault();
        const mode = dropCollection ? 'link' : dropEffectFor(e, dropPath!);
        e.dataTransfer.dropEffect = mode === 'link' ? 'link' : mode;
        setOver(dropCollection ? `Add to ${label}` : `${mode === 'move' ? 'Move' : 'Copy'} to ${label}`);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        if (!droppable) return;
        e.preventDefault();
        setOver(null);
        const paths = readDragPaths(e);
        if (!paths.length) return;
        if (dropCollection) void call('cat:addToCollection', { id: dropCollection, paths }).catch(toastError);
        else void dropOnto(dropPath!, paths, dropEffectFor(e, dropPath!));
      }}
    >
      <span className="sidebar-icon" style={iconColor ? { color: iconColor } : undefined}><Icon name={icon} size={15} /></span>
      <span className="sidebar-label">{over ?? label}</span>
      {unavailable && <span className="sidebar-badge" aria-hidden>Unavailable</span>}
      {count !== undefined && <span className="sidebar-count tabular">{count}</span>}
      {extra}
    </button>
  );
}
