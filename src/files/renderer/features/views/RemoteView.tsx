import React, { useEffect, useMemo } from 'react';
import { useStore } from '../../state/store';
import { currentLocation, ensureListing, listingKeyFor, listings, scrollMemory, setSelection, updatePane, type Pane as PaneT } from '../../state/workspace';
import { connectionOf, remote } from '../../state/remote';
import { app, openDialog } from '../../state/app';
import { getContext, runCommand, type CommandContext } from '../../commands';
import { cmdItem, tidy } from '../../menus';
import { openEntry } from '../../actions';
import { arrange, GridView, ListView } from '../FileViews';
import { StatusBar } from '../Chrome';
import { EmptyState, ErrorState, Loading, Pill, SEP, useMenu, type MenuItem } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { remoteProtocolLabel, remoteRef, type RemoteConnectionInfo } from '../../../shared/remote';
import type { FileEntry } from '../../../shared/model';

/** Details columns that mean something for items on a server. */
const REMOTE_COLUMNS: ReadonlySet<string> = new Set(['size', 'modified', 'type', 'ext']);

/** How the connection protects what it carries, in plain words. */
export function transportLabel(c: Pick<RemoteConnectionInfo, 'protocol' | 'secure'>): { text: string; tone: 'success' | 'warning' } {
  if (c.protocol === 'sftp') return { text: 'Encrypted (SSH)', tone: 'success' };
  if (c.protocol === 'ftp') return c.secure ? { text: 'Encrypted (FTPS)', tone: 'success' } : { text: 'Not encrypted (FTP)', tone: 'warning' };
  return c.secure ? { text: 'Encrypted (HTTPS)', tone: 'success' } : { text: 'Not encrypted (HTTP)', tone: 'warning' };
}

function entryMenu(ctx: CommandContext, entry: FileEntry): MenuItem[] {
  const isDir = entry.kind === 'directory' || entry.linkTargetKind === 'directory';
  return tidy([
    cmdItem('file.open', ctx),
    ...(isDir ? [cmdItem('file.openTab', ctx)] : [cmdItem('remote.preview', ctx)]),
    cmdItem('remote.download', ctx),
    SEP,
    cmdItem('edit.cut', ctx),
    cmdItem('edit.copy', ctx),
    cmdItem('file.copyToOther', ctx),
    cmdItem('file.moveToOther', ctx),
    SEP,
    cmdItem('file.rename', ctx),
    cmdItem('remote.copyAddress', ctx),
    cmdItem('file.copyName', ctx),
    cmdItem('file.properties', ctx),
    SEP,
    cmdItem('file.delete', ctx, 'Delete permanently on the server…'),
  ]);
}

function backgroundMenu(ctx: CommandContext): MenuItem[] {
  return tidy([
    cmdItem('file.newFolder', ctx),
    cmdItem('edit.paste', ctx),
    cmdItem('edit.selectAll', ctx),
    SEP,
    cmdItem('nav.refresh', ctx),
    cmdItem('remote.copyAddress', ctx),
    cmdItem('view.hidden', ctx),
    SEP,
    cmdItem('remote.disconnect', ctx),
    cmdItem('remote.manage', ctx),
  ]);
}

/**
 * A folder on a server (SFTP, WebDAV or FTP/FTPS), shown like a local folder: details,
 * list and grid views, sorting and filtering, selection, drag and drop, and
 * the registered file commands that work on servers. Folder-only views
 * (columns, tree) fall back to Details; thumbnails are not downloaded.
 */
export function RemoteFolder({ tabId, pane, isActive, showStatus }: { tabId: string; pane: PaneT; isActive: boolean; showStatus: boolean }) {
  const loc = currentLocation(pane);
  const key = listingKeyFor(tabId, pane);
  useEffect(() => {
    ensureListing(tabId, pane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const listing = useStore(listings, (s) => s[key]);
  const id = loc.kind === 'remote' ? loc.connectionId : '';
  const dirPath = loc.kind === 'remote' ? loc.path : '/';
  const conn = useStore(remote, (s) => s.connections.find((c) => c.id === id));
  const menu = useMenu();
  const rows = useMemo(() => arrange(listing?.entries ?? [], pane.sort, pane.groupBy, pane.filter, {}, pane.thenBy), [listing?.entries, pane.sort, pane.groupBy, pane.filter, pane.thenBy]);
  const selectedEntries = useMemo(() => {
    const set = new Set(pane.selection);
    return (listing?.entries ?? []).filter((e) => set.has(e.path));
  }, [listing?.entries, pane.selection]);
  const selectedBytes = selectedEntries.every((e) => e.kind !== 'directory') ? selectedEntries.reduce((a, e) => a + (e.size ?? 0), 0) : undefined;
  if (loc.kind !== 'remote') return null;

  const onContext = (e: React.MouseEvent, entry?: FileEntry) => {
    const ctx = getContext(entry);
    menu.open(entry ? entryMenu(ctx, entry) : backgroundMenu(ctx), e.clientX, e.clientY);
  };
  const view = pane.view === 'columns' || pane.view === 'tree' ? 'details' : pane.view;
  const viewProps = {
    rows,
    selection: pane.selection,
    focus: pane.focus,
    view,
    sort: pane.sort,
    thenBy: pane.thenBy,
    active: isActive,
    scrollTop: pane.scrollTop,
    dropDir: remoteRef(id, dirPath),
    onlyColumns: REMOTE_COLUMNS,
    onSort: (sort: PaneT['sort']) => updatePane(pane.id, { sort, thenBy: pane.thenBy.filter((t) => t.key !== sort.key) }),
    onSelect: (paths: string[], anchor?: string, focus?: string) => setSelection(pane.id, paths, anchor, focus),
    onOpen: (e: FileEntry, mode: 'here' | 'tab') => void openEntry(pane.id, e, mode),
    onContext,
    onScroll: (top: number) => scrollMemory.set(pane.id, top),
    onActivate: () => undefined,
  };

  let body: React.ReactNode;
  if (!conn) {
    body = <ErrorState title="This remote connection no longer exists" body="It was removed. Add it again to browse this server."><button type="button" className="btn btn-default btn-md" onClick={() => void runCommand('remote.add')}>Add remote connection…</button></ErrorState>;
  } else if (!listing || (listing.status === 'loading' && !listing.entries.length)) {
    body = <Loading label={`Reading ${conn.name}:${dirPath}…`} />;
  } else if (listing.status === 'error' && listing.error) {
    const e = listing.error;
    const notConnected = e.cause === 'not_connected' || /^(needs_secret|host_key)/.test(e.cause ?? '');
    body = (
      <ErrorState
        title={notConnected ? `Not connected to ${conn.name}` : e.category === 'permission_denied' ? 'The server does not allow opening this folder' : e.category === 'not_found' ? 'This folder does not exist on the server' : e.category === 'unavailable' ? `${conn.name} is not reachable` : 'This folder could not be read'}
        body={e.message}
        errorId={e.errorId}
      >
        <button type="button" className="btn btn-default btn-md" onClick={() => void runCommand('nav.refresh')}>{notConnected ? 'Connect' : 'Try again'}</button>
        <button type="button" className="btn btn-ghost btn-md" onClick={() => openDialog('remoteEdit', { id })}>Edit connection…</button>
        {dirPath !== '/' && <button type="button" className="btn btn-ghost btn-md" onClick={() => void runCommand('nav.up')}>Go to parent folder</button>}
      </ErrorState>
    );
  } else if (!rows.length) {
    body = pane.filter ? (
      <EmptyState icon="search" title="No items match the filter" body={`Nothing in this folder contains “${pane.filter}”.`}>
        <button type="button" className="btn btn-default btn-md" onClick={() => updatePane(pane.id, { filter: '' })}>Clear filter</button>
      </EmptyState>
    ) : (
      <EmptyState icon="folderOpen" title="This folder on the server is empty" body={app.get().settings.showHidden ? 'Paste or drop files here to upload them.' : 'Hidden items are not shown. Paste or drop files here to upload them.'}>
        <button type="button" className="btn btn-default btn-md" onClick={() => void runCommand('file.newFolder')}>New folder</button>
      </EmptyState>
    );
  } else if (view === 'grid' || view === 'gallery' || view === 'thumbnails') body = <GridView {...viewProps} />;
  else body = <ListView {...viewProps} view={view} />;

  const transport = conn ? transportLabel(conn) : undefined;
  return (
    <div className="pane-content remote-folder" data-pane={pane.id}>
      {conn && (
        <div className="remote-bar" role="status">
          <Icon name="server" size={14} />
          <span className="remote-bar-name" title={`${conn.username}@${conn.host}:${conn.port}`}>{conn.name}</span>
          <span className="remote-bar-where mono muted">{remoteProtocolLabel(conn)} · {conn.username}@{conn.host}</span>
          {transport && <Pill tone={transport.tone}>{transport.text}</Pill>}
          {!conn.connected && listing?.status === 'ready' && <Pill tone="neutral">Disconnected</Pill>}
        </div>
      )}
      {listing && listing.entries.length > 0 && (pane.filter || listing.entries.length > 40) && (
        <div className="filterbar">
          <Icon name="search" size={13} />
          <input value={pane.filter} placeholder="Filter this folder" aria-label="Filter this folder" onChange={(e) => updatePane(pane.id, { filter: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && updatePane(pane.id, { filter: '' })} />
        </div>
      )}
      {listing?.refused?.length ? (
        <div className="pane-note warning-text" role="note">
          <Icon name="shieldAlert" size={13} />
          <span>{listing.refused.length} item{listing.refused.length === 1 ? '' : 's'} on the server {listing.refused.length === 1 ? 'has a name' : 'have names'} that would leave this folder or are not valid (such as “../x” or “a/b”); {listing.refused.length === 1 ? 'it is' : 'they are'} not shown and never used.</span>
        </div>
      ) : null}
      {(pane.view === 'columns' || pane.view === 'tree') && <div className="pane-note muted">The {pane.view === 'columns' ? 'Columns' : 'Tree'} view is not available for folders on a server; showing Details.</div>}
      <div className="pane-view">{body}</div>
      {showStatus && <StatusBar count={listing?.entries.length} selected={pane.selection.length} selectedBytes={selectedBytes} loading={listing?.status === 'loading'} />}
      {menu.node}
    </div>
  );
}

/** Crumbs of a remote folder: the connection name (top of the server), then each folder. */
export function remoteCrumbs(connectionId: string, p: string): Array<{ label: string; title: string; path: string }> {
  const name = connectionOf(connectionId)?.name ?? 'Remote';
  const out = [{ label: name, title: `${name}:/`, path: '/' }];
  let acc = '';
  for (const seg of p.split('/').filter(Boolean)) {
    acc += `/${seg}`;
    out.push({ label: seg, title: `${name}:${acc}`, path: acc });
  }
  return out;
}
