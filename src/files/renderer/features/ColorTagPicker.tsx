import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  colorTagStore, loadColorTags, assignColorTag, unassignColorTag, getTagsForPath,
  createColorTag, updateColorTag, deleteColorTag, setColorTagFilter,
} from '../state/colorTags';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/components';

/** Colored dot for file list rows. */
export function ColorDot({ path }: { path: string }) {
  const { tags, fileTags } = useStore(colorTagStore, (s) => ({ tags: s.tags, fileTags: s.fileTags }));
  const tagIds = fileTags.get(path) ?? [];
  if (!tagIds.length) return null;
  const first = tags.find((t) => t.id === tagIds[0]);
  if (!first) return null;
  return (
    <span
      className="color-dot"
      title={first.label}
      style={{ background: first.hex, width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }}
    />
  );
}

/** Filter bar for filtering the file list by color tag. */
export function ColorTagFilterBar() {
  const { tags, filterTagId } = useStore(colorTagStore, (s) => ({ tags: s.tags, filterTagId: s.filterTagId }));
  if (!tags.length) return null;

  return (
    <div className="color-tag-filter" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', padding: '0 var(--sp-3)' }}>
      <span style={{ fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-secondary)' }}>Filter:</span>
      <button
        type="button"
        className={`color-tag-chip ${!filterTagId ? 'active' : ''}`}
        onClick={() => setColorTagFilter(null)}
        style={{
          padding: '2px 8px', borderRadius: 10, border: '1px solid var(--glass-border)',
          background: !filterTagId ? 'var(--accent)' : 'transparent',
          color: !filterTagId ? 'var(--text-on-accent)' : 'var(--text-secondary)',
          fontSize: 'var(--fs-xs, 11px)', cursor: 'pointer',
        }}
      >All</button>
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`color-tag-chip ${filterTagId === t.id ? 'active' : ''}`}
          onClick={() => setColorTagFilter(filterTagId === t.id ? null : t.id)}
          style={{
            padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
            border: filterTagId === t.id ? `2px solid ${t.hex}` : '1px solid var(--glass-border)',
            background: filterTagId === t.id ? t.hex + '22' : 'transparent',
            color: 'var(--text-primary)', fontSize: 'var(--fs-xs, 11px)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.hex, display: 'inline-block' }} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Picker popover for assigning color tags to selected files. */
export function ColorTagPicker({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const { tags } = useStore(colorTagStore, (s) => ({ tags: s.tags }));
  const [managing, setManaging] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newHex, setNewHex] = useState('#1e88e5');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editHex, setEditHex] = useState('');
  const currentTags = paths.length === 1 ? getTagsForPath(paths[0]!) : [];

  useEffect(() => { void loadColorTags(); }, []);

  const toggle = async (tagId: string) => {
    if (currentTags.includes(tagId)) await unassignColorTag(paths, tagId);
    else await assignColorTag(paths, tagId);
  };

  if (managing) {
    return (
      <div className="color-tag-picker" style={{
        background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--glass-border)', borderRadius: 8,
        padding: 'var(--sp-4)', minWidth: 240, boxShadow: 'var(--shadow-float)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Manage tags</strong>
          <button type="button" onClick={() => setManaging(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Icon name="back" size={14} />
          </button>
        </div>
        {tags.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            {editId === t.id ? (
              <>
                <input type="color" value={editHex} onChange={(e) => setEditHex(e.target.value)} style={{ width: 24, height: 24, border: 'none', padding: 0, cursor: 'pointer' }} />
                <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={{ flex: 1, padding: '2px 6px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)' }} />
                <button type="button" onClick={async () => { await updateColorTag(t.id, editLabel, editHex); setEditId(null); }}
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 'var(--fs-xs, 11px)' }}>Save</button>
              </>
            ) : (
              <>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.hex }} />
                <span style={{ flex: 1, color: 'var(--text-primary)' }}>{t.label}</span>
                <button type="button" onClick={() => { setEditId(t.id); setEditLabel(t.label); setEditHex(t.hex); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><Icon name="edit" size={12} /></button>
                <button type="button" onClick={() => void deleteColorTag(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)' }}><Icon name="trash" size={12} /></button>
              </>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', alignItems: 'center' }}>
          <input type="color" value={newHex} onChange={(e) => setNewHex(e.target.value)} style={{ width: 24, height: 24, border: 'none', padding: 0, cursor: 'pointer' }} />
          <input placeholder="New tag name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            style={{ flex: 1, padding: '2px 6px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)' }} />
          <Button onClick={async () => { if (newLabel) { await createColorTag(newLabel, newHex); setNewLabel(''); } }} disabled={!newLabel}>Add</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="color-tag-picker" style={{
      background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))',
      border: '1px solid var(--glass-border)', borderRadius: 8,
      padding: 'var(--sp-4)', minWidth: 180, boxShadow: 'var(--shadow-float)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Color tag</strong>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {tags.map((t) => (
        <button key={t.id} type="button" onClick={() => void toggle(t.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%',
            padding: '4px 8px', background: 'none', border: 'none', borderRadius: 4,
            cursor: 'pointer', color: 'var(--text-primary)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-inset)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        >
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.hex, flexShrink: 0, border: currentTags.includes(t.id) ? '2px solid var(--text-primary)' : 'none' }} />
          <span>{t.label}</span>
          {currentTags.includes(t.id) && <Icon name="check" size={12} />}
        </button>
      ))}
      {paths.length === 1 && currentTags.length > 0 && (
        <button type="button" onClick={async () => { for (const tid of currentTags) await unassignColorTag(paths, tid); }}
          style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: 'var(--sp-2)', padding: '4px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--fs-xs, 11px)' }}>
          Clear all
        </button>
      )}
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 'var(--sp-3) 0' }} />
      <button type="button" onClick={() => setManaging(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', width: '100%', padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
        <Icon name="settings" size={12} /> Manage tags
      </button>
    </div>
  );
}
