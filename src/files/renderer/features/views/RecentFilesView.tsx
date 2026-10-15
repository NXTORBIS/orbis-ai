import { useCallback, useEffect, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { navigate, activePane } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { IconButton, SEP, useMenu, type MenuItem } from '../../ui/components';
import type { RecentFile } from '../../../shared/recentFiles';
import { groupRecentFiles, GROUP_LABELS, type RecentGroup } from '../../../shared/recentFiles';

export function RecentFilesView() {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const menu = useMenu();

  const load = useCallback(async () => {
    try {
      const list = await call('recent:list', { limit: 500 }) as RecentFile[];
      setFiles(list);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups = groupRecentFiles(files);

  const handleOpen = (f: RecentFile) => {
    void navigate(activePane().id, { kind: 'fs', path: f.path.substring(0, f.path.lastIndexOf('/')) || '/' });
  };

  const handlePin = async (f: RecentFile) => {
    try {
      if (f.pinned) {
        await call('recent:unpin', { id: f.id });
      } else {
        await call('recent:pin', { id: f.id });
      }
      await load();
    } catch (err) {
      toastError(err);
    }
  };

  const handleRemove = async (f: RecentFile) => {
    try {
      await call('recent:remove', { id: f.id });
      await load();
    } catch (err) {
      toastError(err);
    }
  };

  const handleClear = async () => {
    try {
      await call('recent:clear', {});
      await load();
      toast({ level: 'success', title: 'History cleared (pinned items kept)' });
    } catch (err) {
      toastError(err);
    }
  };

  const fileMenu = (f: RecentFile): MenuItem[] => [
    { label: 'Open containing folder', icon: 'folder', run: () => handleOpen(f) },
    { label: 'Open file', icon: 'open', run: () => void call('fs:open', { path: f.path }) },
    SEP,
    { label: f.pinned ? 'Unpin' : 'Pin', icon: f.pinned ? 'unpin' : 'pin', run: () => void handlePin(f) },
    { label: 'Remove from history', icon: 'close', run: () => void handleRemove(f) },
  ];

  const extIcon = (ext: string) => {
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a'].includes(ext)) return 'audio';
    if (['pdf'].includes(ext)) return 'file';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
    return 'file';
  };

  const renderGroup = (group: RecentGroup) => {
    const items = groups.get(group) ?? [];
    if (items.length === 0) return null;
    return (
      <section key={group} className="recent-group">
        <h3 className="recent-group-label">{GROUP_LABELS[group]}</h3>
        <ul className="recent-list">
          {items.map((f) => (
            <li
              key={f.id}
              className={`recent-item ${f.pinned ? 'is-pinned' : ''}`}
              onDoubleClick={() => void call('fs:open', { path: f.path })}
              onContextMenu={(e) => { e.preventDefault(); menu.open(fileMenu(f), e.clientX, e.clientY); }}
            >
              <Icon name={extIcon(f.ext)} size={16} />
              <div className="recent-item-info">
                <span className="recent-item-name">{f.name}</span>
                <span className="recent-item-path">{f.path}</span>
              </div>
              <span className="recent-item-count" title={`Opened ${f.accessCount} time${f.accessCount === 1 ? '' : 's'}`}>{f.accessCount}</span>
              <IconButton
                icon={f.pinned ? 'unpin' : 'pin'}
                label={f.pinned ? 'Unpin' : 'Pin'}
                onClick={() => void handlePin(f)}
              />
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="tool-view scroll-y recent-files-view">
      <header className="view-header">
        <h1>Recent Files</h1>
        <div className="view-actions">
          <IconButton icon="refresh" label="Refresh" onClick={() => void load()} />
          <IconButton icon="trash" label="Clear history" onClick={() => void handleClear()} />
        </div>
      </header>
      {loading ? (
        <div className="view-empty"><p>Loading…</p></div>
      ) : files.length === 0 ? (
        <div className="view-empty"><Icon name="clock" size={32} /><p>No recent files yet</p></div>
      ) : (
        <div className="recent-groups">
          {renderGroup('today')}
          {renderGroup('yesterday')}
          {renderGroup('thisWeek')}
          {renderGroup('older')}
        </div>
      )}
      {menu.node}
    </div>
  );
}
