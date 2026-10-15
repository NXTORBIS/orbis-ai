import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { clipboardHistory, loadClipboardHistory, recopyItem, pinItem, unpinItem, removeItem, clearHistory, toggleClipboardHistory } from '../state/clipboardHistory';
import { IconButton, EmptyState } from '../ui/components';
import { Icon } from '../ui/Icon';
import { toast, toastError } from '../state/app';
import type { ClipHistoryItem } from '../../shared/clipboardHistory';

function ClipItem({ item }: { item: ClipHistoryItem }) {
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    setCopying(true);
    try {
      await recopyItem(item.id);
      toast({ level: 'success', title: 'Copied to clipboard.' });
    } catch (e) { toastError(e); }
    setCopying(false);
  };

  const handlePin = async () => {
    try {
      if (item.pinned) await unpinItem(item.id);
      else await pinItem(item.id);
    } catch (e) { toastError(e); }
  };

  const handleRemove = async () => {
    try {
      await removeItem(item.id);
    } catch (e) { toastError(e); }
  };

  const age = Date.now() - item.copiedMs;
  const timeLabel = age < 60000 ? 'Just now'
    : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
    : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
    : `${Math.floor(age / 86400000)}d ago`;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
      padding: 'var(--sp-3) var(--sp-4)',
      borderBottom: '1px solid var(--border)',
      background: item.pinned ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
    }}>
      <span style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-secondary)' }}>
        <Icon name={item.kind === 'text' ? 'file' : item.kind === 'image' ? 'image' : 'folder'} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', color: 'var(--text-primary)',
        }}>
          {item.kind === 'image' && item.thumbnail ? (
            <img src={`data:image/jpeg;base64,${item.thumbnail}`} alt="Clipboard image"
              style={{ maxWidth: 80, maxHeight: 40, borderRadius: 4 }} />
          ) : item.preview}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: 2 }}>
          {item.kind} &middot; {timeLabel}
          {item.pinned && <> &middot; <Icon name="pin" size={10} /> pinned</>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <IconButton icon="copy" label="Re-copy" onClick={handleCopy} disabled={copying} />
        <IconButton icon={item.pinned ? 'pin' : 'pinOutline'} label={item.pinned ? 'Unpin' : 'Pin'} onClick={handlePin} />
        <IconButton icon="close" label="Remove" onClick={handleRemove} />
      </div>
    </div>
  );
}

export function ClipboardHistoryPanel() {
  const { items, loading, open } = useStore(clipboardHistory, (s) => s);
  const [filter, setFilter] = useState<'all' | 'text' | 'image' | 'files'>('all');

  useEffect(() => {
    if (open) void loadClipboardHistory();
  }, [open]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i: ClipHistoryItem) => i.kind === filter);
  }, [items, filter]);

  if (!open) return null;

  return (
    <div className="clipboard-history-panel" style={{
      position: 'fixed', right: 'var(--sp-5)', top: 60, bottom: 60,
      width: 'min(380px, calc(100vw - 32px))',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-surface)', borderRadius: 8,
      boxShadow: 'var(--shadow-float)', border: '1px solid var(--glass-border)',
      zIndex: 850,
      animation: 'rise var(--dur-med) ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
        padding: 'var(--sp-4) var(--sp-5)',
        borderBottom: '1px solid var(--border)',
      }}>
        <Icon name="clipboard" size={18} />
        <span style={{ fontWeight: 600, flex: 1 }}>Clipboard History</span>
        <IconButton icon="trash" label="Clear all" onClick={() => void clearHistory()} />
        <IconButton icon="close" label="Close" onClick={toggleClipboardHistory} />
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', gap: 'var(--sp-1)',
        padding: 'var(--sp-2) var(--sp-4)',
        borderBottom: '1px solid var(--border)',
      }}>
        {(['all', 'text', 'image', 'files'] as const).map((f) => (
          <button key={f} type="button"
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize', fontSize: 'var(--fs-xs)' }}>
            {f}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && <div style={{ padding: 'var(--sp-5)', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState icon="clipboard" title="No items" body={filter === 'all' ? 'Copy something to see it here.' : `No ${filter} items.`} />
        )}
        {filtered.map((item: ClipHistoryItem) => <ClipItem key={item.id} item={item} />)}
      </div>
    </div>
  );
}
