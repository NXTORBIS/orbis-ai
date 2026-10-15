import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { bookmarkStore, loadBookmarks, removeBookmark, reorderBookmarks } from '../state/bookmarks';
import { navigate, activePane } from '../state/workspace';
import { Icon } from '../ui/Icon';
import { call } from '../api';
import type { FileEntry } from '../../shared/model';

/** Bookmarks / Favorites bar shown below the tab strip. */
export function BookmarksBar() {
  const { bookmarks, loading } = useStore(bookmarkStore, (s) => ({ bookmarks: s.bookmarks, loading: s.loading }));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [_folderEntries, setFolderEntries] = useState<FileEntry[]>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void loadBookmarks(); }, []);

  if (loading || !bookmarks.length) return null;

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const ids = bookmarks.map((b) => b.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(targetIdx, 0, moved!);
    void reorderBookmarks(ids);
    setDragIdx(null);
  };

  const handleFolderHover = (bookmark: (typeof bookmarks)[number]) => {
    if (bookmark.kind !== 'directory') return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(async () => {
      setHoveredFolder(bookmark.id);
      try {
        await call('fs:listStart', { path: bookmark.path, showHidden: false });
        setFolderEntries([]);
      } catch {
        setFolderEntries([]);
      }
    }, 400);
  };

  return (
    <nav className="bookmarks-bar" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
      padding: '2px var(--sp-4)', height: 28, overflow: 'hidden',
      background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))',
      borderBottom: '1px solid var(--glass-border)', fontSize: 'var(--fs-xs, 11px)',
    }}>
      <Icon name="star" size={12} />
      {bookmarks.map((b, i) => (
        <div
          key={b.id}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragEnd={() => setDragIdx(null)}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={() => handleDrop(i)}
          onMouseEnter={() => handleFolderHover(b)}
          onMouseLeave={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            setHoveredFolder(null);
            setFolderEntries([]);
          }}
          style={{ position: 'relative' }}
        >
          <button
            type="button"
            onClick={() => {
              const pane = activePane();
              if (b.kind === 'directory') navigate(pane.id, { kind: 'fs', path: b.path });
              else void call('fs:open', { path: b.path });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              // Simple context menu: remove or rename
              const action = window.confirm(`Remove bookmark "${b.label}"?`);
              if (action) void removeBookmark(b.id);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4, border: 'none',
              background: dragIdx === i ? 'var(--bg-inset)' : 'transparent',
              color: 'var(--text-primary)', cursor: 'pointer',
              whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            onMouseEnter={(e) => { if (dragIdx === null) (e.currentTarget as HTMLElement).style.background = 'var(--bg-inset)'; }}
            onMouseLeave={(e) => { if (dragIdx === null) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            title={b.path}
          >
            <Icon name={b.kind === 'directory' ? 'folder' : 'file'} size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
          </button>
          {hoveredFolder === b.id && b.kind === 'directory' && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))',
              border: '1px solid var(--glass-border)', borderRadius: 6,
              padding: 'var(--sp-2)', minWidth: 160, boxShadow: 'var(--shadow-float)',
            }}>
              <div style={{ padding: '4px 8px', color: 'var(--text-secondary)', fontSize: 'var(--fs-xs, 11px)' }}>
                Click to open folder
              </div>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
