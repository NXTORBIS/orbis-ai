import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../api';
import { confirm, toast, toastError } from '../../state/app';
import { Button, EmptyState, ErrorState, Loading } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatDate } from '../../ui/format';
import type { RecycleBinItem, RecycleBinSettings } from '../../../shared/recycleBin';

type SortKey = 'name' | 'original' | 'deleted' | 'size';

function compare(a: RecycleBinItem, b: RecycleBinItem, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    case 'original': return a.originalPath.localeCompare(b.originalPath);
    case 'deleted': return a.deletedMs - b.deletedMs;
    case 'size': return a.size - b.size;
  }
}

export function RecycleBinView() {
  const [items, setItems] = useState<RecycleBinItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'deleted', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<RecycleBinSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [purgeDays, setPurgeDays] = useState(30);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await call<RecycleBinItem[]>('recycleBin:list');
      if (seq !== loadSeq.current) return;
      setItems(list);
      setError(null);
      const ids = new Set(list.map((i) => i.id));
      setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError((err as Error).message);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await call<RecycleBinSettings>('recycleBin:getSettings');
    setSettings(s);
    setPurgeDays(s.autoPurgeDays);
  }, []);

  useEffect(() => { void load(); void loadSettings(); }, [load, loadSettings]);

  const sorted = useMemo(() => {
    if (!items) return [];
    const list = items.slice().sort((a, b) => compare(a, b, sort.key));
    return sort.dir === 'desc' ? list.reverse() : list;
  }, [items, sort]);

  const chosen = sorted.filter((i) => selected.has(i.id));
  const totalBytes = sorted.reduce((a, i) => a + i.size, 0);

  const toggleSort = (key: SortKey) => {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  };

  const restore = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const result = await call<{ restored: string[] }>('recycleBin:restore', { ids });
      toast({ level: 'success', title: `Restored ${result.restored.length} item${result.restored.length === 1 ? '' : 's'}.` });
      await load();
    } catch (err) { toastError(err); }
  };

  const permanentDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirm({
      title: 'Permanently delete',
      body: `Permanently delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await call<{ deleted: number }>('recycleBin:permanentDelete', { ids });
      toast({ level: 'success', title: `Permanently deleted ${result.deleted} item${result.deleted === 1 ? '' : 's'}.` });
      await load();
    } catch (err) { toastError(err); }
  };

  const emptyBin = async () => {
    const ok = await confirm({
      title: 'Empty recycle bin',
      body: 'Permanently delete all items in the recycle bin? This cannot be undone.',
      confirmLabel: 'Empty',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await call<{ deleted: number }>('recycleBin:empty');
      toast({ level: 'success', title: `Permanently deleted ${result.deleted} item${result.deleted === 1 ? '' : 's'}.` });
      await load();
    } catch (err) { toastError(err); }
  };

  const saveSettings = async () => {
    try {
      await call('recycleBin:setSettings', { autoPurgeDays: purgeDays, maxSizeBytes: settings?.maxSizeBytes ?? 1024 * 1024 * 1024 });
      toast({ level: 'success', title: 'Settings saved.' });
      await loadSettings();
      setShowSettings(false);
    } catch (err) { toastError(err); }
  };

  const purge = async () => {
    try {
      const result = await call<{ purged: number }>('recycleBin:purgeOld');
      toast({ level: 'success', title: `Purged ${result.purged} old item${result.purged === 1 ? '' : 's'}.` });
      await load();
    } catch (err) { toastError(err); }
  };

  if (error) return <div className="tool-view scroll-y"><ErrorState title="Could not load recycle bin" body={error} /></div>;
  if (!items) return <div className="tool-view scroll-y"><Loading label="Loading recycle bin" /></div>;

  return (
    <div className="tool-view scroll-y">
      <header className="view-header" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-4) var(--sp-5)' }}>
        <Icon name="trash" size={20} />
        <h1 style={{ margin: 0, flex: 1, color: 'var(--text)' }}>Recycle Bin</h1>
        <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)' }}>
          {sorted.length} item{sorted.length === 1 ? '' : 's'} {totalBytes > 0 ? `(${formatBytes(totalBytes)})` : ''}
        </span>
      </header>

      <div style={{ display: 'flex', gap: 'var(--sp-3)', padding: '0 var(--sp-5) var(--sp-3)', flexWrap: 'wrap' }}>
        <Button onClick={restore} disabled={!chosen.length}>
          <Icon name="back" size={13} /> Restore
        </Button>
        <Button onClick={permanentDelete} disabled={!chosen.length}>
          <Icon name="close" size={13} /> Delete permanently
        </Button>
        <Button onClick={emptyBin} disabled={!sorted.length}>
          <Icon name="trash" size={13} /> Empty bin
        </Button>
        <Button onClick={purge}>
          <Icon name="clock" size={13} /> Purge old items
        </Button>
        <Button onClick={() => setShowSettings(!showSettings)}>
          <Icon name="settings" size={13} /> Settings
        </Button>
        <Button onClick={() => void load()}>
          <Icon name="refresh" size={13} /> Refresh
        </Button>
      </div>

      {showSettings && (
        <div style={{
          margin: '0 var(--sp-5) var(--sp-3)',
          padding: 'var(--sp-4)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))',
          border: '1px solid var(--glass-border)', borderRadius: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
            <label style={{ color: 'var(--text)' }}>Auto-purge after (days):</label>
            <input type="number" min={0} max={3650} value={purgeDays} onChange={(e) => setPurgeDays(Number(e.target.value))}
              style={{ width: 80, padding: '2px 6px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)' }}>0 = never</span>
          </div>
          <Button onClick={saveSettings}>Save settings</Button>
        </div>
      )}

      {!sorted.length ? (
        <EmptyState icon="trash" title="Recycle bin is empty" body="Deleted files will appear here." />
      ) : (
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: 32, padding: '4px 8px' }}>
                <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((i) => i.id)) : new Set())} />
              </th>
              {([['name', 'Name'], ['original', 'Original path'], ['deleted', 'Deleted'], ['size', 'Size']] as const).map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)}
                  style={{ padding: '4px 8px', cursor: 'pointer', textAlign: 'left', color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)', userSelect: 'none' }}>
                  {label} {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id}
                className={selected.has(item.id) ? 'selected' : ''}
                onClick={() => setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                  return next;
                })}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              >
                <td style={{ padding: '4px 8px' }}>
                  <input type="checkbox" checked={selected.has(item.id)} readOnly />
                </td>
                <td style={{ padding: '4px 8px', color: 'var(--text)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <Icon name={item.kind === 'directory' ? 'folder' : 'file'} size={14} />
                    {item.name}
                  </div>
                </td>
                <td style={{ padding: '4px 8px', color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)' }} title={item.originalPath}>
                  <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {item.originalPath}
                  </span>
                </td>
                <td style={{ padding: '4px 8px', color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)' }}>
                  {formatDate(item.deletedMs)}
                </td>
                <td style={{ padding: '4px 8px', color: 'var(--text-2)', fontSize: 'var(--fs-xs, 11px)', textAlign: 'right' }}>
                  {formatBytes(item.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
