import React, { useEffect, useMemo, useState } from 'react';
import { app, confirm, refreshCatalog, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { navigate, setSelection, updatePane, type Pane } from '../../state/workspace';
import { call } from '../../api';
import { EmptyState, ErrorState, Loading, useMenu, type MenuItem } from '../../ui/components';
import { arrange, ListView } from '../FileViews';
import { getContext } from '../../commands';
import { entryMenu } from '../Pane';
import { openEntry } from '../../actions';
import { formatDate } from '../../ui/format';
import type { FileEntry } from '../../../shared/model';
import { FileRowActions } from './common';

export interface CatalogItem { id: string; path: string; kind: string; missing: boolean; status?: 'ok' | 'missing' | 'replaced'; description: string | null }

/** Resolve catalogue references into live entries. Missing ones are reported, never shown as present. */
async function resolveItems(items: CatalogItem[]): Promise<{ present: FileEntry[]; missing: CatalogItem[]; byPath: Map<string, CatalogItem> }> {
  const present: FileEntry[] = [];
  const missing: CatalogItem[] = [];
  const byPath = new Map<string, CatalogItem>();
  await Promise.all(
    items.map(async (it) => {
      if (it.missing || it.status === 'missing' || it.status === 'replaced') {
        missing.push(it);
        return;
      }
      try {
        present.push(await call<FileEntry>('fs:stat', { path: it.path }));
        byPath.set(it.path, it);
      } catch {
        missing.push({ ...it, status: 'missing' });
      }
    }),
  );
  return { present, missing, byPath };
}

export function ReferenceList({ title, subtitle, pane, load, onRemove, removeLabel, extraActions, emptyTitle, emptyBody }: {
  title: string; subtitle?: string; pane: Pane; tabId: string; load: () => Promise<CatalogItem[]>; onRemove?: (items: CatalogItem[]) => Promise<void>; removeLabel?: string;
  extraActions?: React.ReactNode; emptyTitle: string; emptyBody: string;
}) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; present: FileEntry[]; missing: CatalogItem[]; byPath: Map<string, CatalogItem>; error?: string }>({ status: 'loading', present: [], missing: [], byPath: new Map() });
  const catTick = useStore(app, (s) => [s.collections, s.tags, s.projects]);
  const menu = useMenu();
  const reload = () => {
    void load()
      .then(resolveItems)
      .then((r) => setState({ status: 'ready', ...r }), (err) => setState((s) => ({ ...s, status: 'error', error: (err as Error).message })));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [catTick]);
  const rows = useMemo(() => arrange(state.present, pane.sort, pane.groupBy, pane.filter), [state.present, pane.sort, pane.groupBy, pane.filter]);

  const contextFor = (e: React.MouseEvent, entry?: FileEntry) => {
    if (!entry) return;
    const ctx = getContext(entry);
    const items: MenuItem[] = entryMenu(ctx, entry).filter((i) => !['edit.paste', 'file.newFolder'].includes(i.id ?? ''));
    if (onRemove) {
      items.unshift({ label: removeLabel ?? 'Remove from list', icon: 'minus', run: () => void onRemove(ctx.selection.map((s) => state.byPath.get(s.path)).filter((x): x is CatalogItem => !!x)).then(reload) }, { label: '', separator: true });
    }
    items.unshift({ label: 'Show in folder', icon: 'folderOpen', run: () => void navigate(pane.id, { kind: 'fs', path: entry.path }) });
    menu.open(items, e.clientX, e.clientY);
  };

  return (
    <div className="pane-content">
      <header className="view-header compact">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <span className="spacer" />
        {extraActions}
      </header>
      <div className="pane-view">
        {state.status === 'loading' ? <Loading label="Checking references…" /> : state.status === 'error' ? <ErrorState title="Could not load this list" body={state.error} /> : !state.present.length && !state.missing.length ? (
          <EmptyState icon="collection" title={emptyTitle} body={emptyBody} />
        ) : (
          <div className="stack fill">
            {state.present.length > 0 && (
              <div className="fill">
                <ListView
                  rows={rows}
                  selection={pane.selection}
                  focus={pane.focus}
                  view={pane.view === 'details' || pane.view === 'list' || pane.view === 'compact' ? pane.view : 'details'}
                  sort={pane.sort}
                  active
                  showLocation
                  onSort={(sort) => updatePane(pane.id, { sort })}
                  onSelect={(p, a, f) => setSelection(pane.id, p, a, f)}
                  onOpen={(e, mode) => void openEntry(pane.id, e, mode)}
                  onContext={contextFor}
                  onScroll={() => undefined}
                  onActivate={() => undefined}
                />
              </div>
            )}
            {state.missing.length > 0 && (
              <div className="missing-refs" role="region" aria-label="Missing references">
                <h3>{state.missing.length} reference{state.missing.length === 1 ? '' : 's'} no longer found</h3>
                <p className="muted">These items were moved outside Orbis Files, deleted, or their drive is disconnected. The list keeps the reference; nothing points at a different file.</p>
                {state.missing.map((m) => (
                  <div key={m.id} className="missing-row">
                    <span className="mono">{m.path}</span>
                    <span className="muted">{m.status === 'replaced' ? 'A different file now has this name' : 'Not found'}</span>
                    {onRemove && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onRemove([m]).then(reload)}>{removeLabel ?? 'Remove'}</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {menu.node}
    </div>
  );
}

export function CollectionView({ id, pane, tabId }: { id: string; pane: Pane; tabId: string }) {
  const col = useStore(app, (s) => s.collections.find((c) => c.id === id));
  if (!col) return <ErrorState title="This collection no longer exists" />;
  return (
    <ReferenceList
      key={id}
      title={col.name}
      subtitle="A collection references files where they are. Removing an item here never deletes the file."
      pane={pane}
      tabId={tabId}
      load={() => call<CatalogItem[]>('cat:collectionItems', { id })}
      removeLabel="Remove from collection"
      onRemove={async (items) => {
        await call('cat:removeFromCollection', { id, itemIds: items.map((i) => i.id) }).catch(toastError);
      }}
      emptyTitle="This collection is empty"
      emptyBody="Drag files onto the collection in the sidebar, or use right-click → Add to collection."
    />
  );
}

export function LibraryView({ category, pane, tabId }: { category: string; pane: Pane; tabId: string }) {
  const tags = useStore(app, (s) => s.tags);
  if (category.startsWith('tag:')) {
    const tagId = category.slice(4);
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return <ErrorState title="This tag no longer exists" />;
    return (
      <ReferenceList
        key={category}
        title={`Tag · ${tag.name}`}
        subtitle="Tags are stored by Orbis Files, not inside the files."
        pane={pane}
        tabId={tabId}
        load={() => call<CatalogItem[]>('cat:itemsWithTag', { tagId })}
        removeLabel="Remove tag"
        onRemove={async (items) => {
          await call('cat:untagItems', { tagId, paths: items.map((i) => i.path) }).catch(toastError);
        }}
        emptyTitle="Nothing has this tag"
        emptyBody="Right-click items and choose Tags to apply it."
      />
    );
  }
  if (category === 'recent') return <RecentView paneId={pane.id} />;
  if (category === 'generated') return <GeneratedView paneId={pane.id} />;
  if (category.startsWith('provider:')) return <ProviderView key={category} providerId={category.slice(9)} paneId={pane.id} />;
  return <ErrorState title="Unknown library section" />;
}

interface ProviderItem { id: string; providerId: string; type: string; title: string; path?: string; modifiedMs?: number; size?: number; source?: string; present: boolean; editable?: boolean; openUri?: string; description?: string }

/**
 * Items from a content source registered by the Orbis app (a content feed).
 * Items stay in their native format: Orbis Files lists them and asks the Orbis
 * app to open them; it never edits or deletes them.
 */
function ProviderView({ providerId, paneId }: { providerId: string; paneId: string }) {
  const info = useStore(app, (s) => s.providers.find((p) => p.id === providerId));
  const [items, setItems] = useState<ProviderItem[] | null>(null);
  const [type, setType] = useState('');
  const [filter, setFilter] = useState('');
  const load = () => {
    setItems(null);
    void call<ProviderItem[]>('lib:list', { providerId, limit: 10000 })
      .then((list) => {
        setItems(list);
        void refreshCatalog('providers');
      }, (err) => {
        setItems([]);
        toastError(err);
      });
  };
  useEffect(load, [providerId]);
  const types = useMemo(() => [...new Set((items ?? []).map((i) => i.type))].sort(), [items]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (items ?? []).filter((i) => (!type || i.type === type) && (!q || i.title.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)));
  }, [items, type, filter]);
  if (!info) return <ErrorState title="This content source is not registered" body="The Orbis app registers its content sources when it connects. Nothing is simulated while it is absent." />;
  const open = (it: ProviderItem) => void call<{ opened: string }>('lib:openItem', { providerId, itemId: it.id }).then((r) => {
    if (r.opened === 'uri') toast({ level: 'info', title: `Asked the Orbis app to open “${it.title}”` });
  }, toastError);
  return (
    <div className="pane-content">
      <header className="view-header compact">
        <div>
          <h1>{info.label}</h1>
          <p className="muted">{info.note ?? 'Provided by the Orbis app.'} {info.removalSemantics}</p>
        </div>
        <span className="spacer" />
        <input className="input narrow" placeholder="Filter" aria-label="Filter items" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {types.length > 1 && (
          <select className="input" aria-label="Item type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-default btn-sm" onClick={load}>Refresh</button>
      </header>
      <div className="pane-view scroll-y">
        {info.availability === 'error' && <div className="callout warning" role="alert">{info.note}</div>}
        {!items ? <Loading label="Reading the feed…" /> : !shown.length ? (
          <EmptyState icon="plug" title={items.length ? 'No items match' : 'No items'} body={items.length ? 'Change the filter to see more.' : 'The Orbis app has not listed any items in this source yet.'} />
        ) : (
          <table className="table">
            <thead><tr><th>Title</th><th>Type</th><th>Modified</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((it) => (
                <tr key={it.id} className={it.present ? 'clickable' : 'is-missing'} onDoubleClick={() => (it.openUri || (it.path && it.present)) && open(it)}>
                  <td>
                    <div>{it.title}{!it.present && <span className="pill pill-warning">file missing</span>}</div>
                    {it.description && <div className="muted small">{it.description}</div>}
                    {it.path && <div className="mono muted small">{it.path}</div>}
                  </td>
                  <td className="small">{it.type.replace(/_/g, ' ')}</td>
                  <td className="tabular">{it.modifiedMs ? formatDate(it.modifiedMs) : '—'}</td>
                  <td className="row-actions">
                    {(it.openUri || (it.path && it.present)) && <button type="button" className="btn btn-ghost btn-sm" title={it.openUri ? 'Opens in the Orbis app' : 'Opens the file'} onClick={() => open(it)}>{it.openUri ? 'Open in Orbis' : 'Open'}</button>}
                    {it.path && it.present && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigate(paneId, { kind: 'fs', path: it.path!.replace(/[\\/][^\\/]+$/, '') || it.path! }, { select: it.path })}>Show</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RecentView({ paneId }: { paneId: string }) {
  const recents = useStore(app, (s) => s.recents);
  useEffect(() => {
    void call('cat:recents', { limit: 500 }).then((r) => app.set({ recents: r as typeof recents }), () => undefined);
  }, []);
  return (
    <div className="pane-content">
      <header className="view-header compact">
        <div>
          <h1>Recent</h1>
          <p className="muted">Items you opened in Orbis Files on this profile. Opening files in other apps is not tracked.</p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-default btn-sm" disabled={!recents.length} onClick={async () => {
          if (await confirm({ title: 'Clear recent items?', body: 'Only this history is cleared. No files are affected.', confirmLabel: 'Clear' })) await call('cat:clearRecents').catch(toastError);
        }}>Clear history</button>
      </header>
      <div className="pane-view scroll-y">
        {!recents.length ? <EmptyState icon="clock" title="No recent items" body="Files and folders you open will appear here." /> : (
          <table className="table">
            <thead><tr><th>Name</th><th className="wide-only">Location</th><th>Last opened</th><th className="num wide-only">Times</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {recents.map((r) => (
                <tr key={r.path} className={r.exists ? 'clickable' : 'is-missing'} onDoubleClick={() => r.exists && (r.kind === 'directory' ? void navigate(paneId, { kind: 'fs', path: r.path }) : void import('../../actions').then((A) => A.openFile(r.path)))}>
                  <td className="cell-name-min">{r.path.split(/[\\/]/).filter(Boolean).pop()}{!r.exists && <span className="pill pill-warning">missing</span>}<div className="cell-sub narrow-only mono">{r.path}</div></td>
                  <td className="mono muted cell-path wide-only">{r.path}</td>
                  <td className="tabular">{formatDate(r.lastMs)}</td>
                  <td className="tabular num wide-only">{r.count}</td>
                  <td className="row-actions">{r.exists && <FileRowActions path={r.path} folder={r.kind === 'directory'} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface Generated { id: string; path: string; generator: string; chatId: string | null; prompt: string | null; createdMs: number; exists?: boolean; size?: number }

function GeneratedView({ paneId }: { paneId: string }) {
  const [items, setItems] = useState<Generated[] | null>(null);
  const load = () => void call<Generated[]>('cat:generated').then(setItems, toastError);
  useEffect(load, []);
  return (
    <div className="pane-content">
      <header className="view-header compact">
        <div>
          <h1>AI-generated</h1>
          <p className="muted">Files created by Orbis AI or registered by the Orbis app, kept separate from your own uploads. Each entry records where it came from.</p>
        </div>
      </header>
      <div className="pane-view scroll-y">
        {!items ? <Loading label="Loading…" /> : !items.length ? (
          <EmptyState icon="sparkle" title="No AI-generated files yet" body="When Orbis AI saves a file, or the Orbis app registers one, it appears here with its source chat. Your own files are never listed here." />
        ) : (
          <table className="table">
            <thead><tr><th>File</th><th>Source</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className={g.exists ? 'clickable' : 'is-missing'} onDoubleClick={() => g.exists && void import('../../actions').then((A) => A.openFile(g.path))}>
                  <td><div>{g.path.split(/[\\/]/).pop()}{!g.exists && <span className="pill pill-warning">missing</span>}</div><div className="mono muted small">{g.path}</div></td>
                  <td>{g.generator}{g.chatId && <div className="muted small">chat {g.chatId}</div>}{g.prompt && <div className="muted small" title={g.prompt}>“{g.prompt.slice(0, 80)}{g.prompt.length > 80 ? '…' : ''}”</div>}</td>
                  <td className="tabular">{formatDate(g.createdMs)}</td>
                  <td className="row-actions">
                    {g.exists && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigate(paneId, { kind: 'fs', path: g.path })}>Show</button>}
                    <button type="button" className="btn btn-ghost btn-sm" title="Removes the entry only; the file stays on disk." onClick={() => void call('cat:removeGeneratedEntry', { id: g.id }).then(load, toastError)}>Remove entry</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function SavedSearchView({ id, paneId }: { id: string; paneId: string }) {
  const saved = useStore(app, (s) => s.savedSearches.find((x) => x.id === id));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    void (async () => {
      // Revalidate the scope; run against whatever still exists and say what doesn't.
      const checks = await Promise.all(saved.scope.map((p) => call<{ exists: boolean }>('fs:resolve', { input: p }).then((r) => [p, r.exists] as const, () => [p, false] as const)));
      const live = checks.filter(([, ok]) => ok).map(([p]) => p);
      const gone = checks.filter(([, ok]) => !ok).map(([p]) => p);
      if (!live.length) {
        setProblem(`None of this search's folders exist any more: ${gone.join(', ')}`);
        return;
      }
      if (gone.length) toast({ level: 'warning', title: 'Some folders in this saved search are missing', detail: gone.join(', ') });
      await navigate(paneId, { kind: 'search', query: saved.query, scope: live }, { push: false });
    })();
  }, [saved, paneId]);
  if (!saved) return <ErrorState title="This saved search no longer exists" />;
  if (problem) return <ErrorState title="Cannot run this saved search" body={problem} />;
  return <Loading label="Running saved search…" />;
}
