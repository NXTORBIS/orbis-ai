import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import { navigate } from '../state/workspace';
import { Icon } from '../ui/Icon';
import type { FileLinkResolved } from '../../shared/fileLinks';

/* -------------------------------------------------------------------------- */
/*  File Link Badge                                                            */
/*  Shows a link indicator on entries that are file links (aliases), with a    */
/*  broken-link indicator when the target no longer exists.                     */
/* -------------------------------------------------------------------------- */

export interface FileLinkBadgeProps {
  linkId: string;
  paneId: string;
  compact?: boolean;
}

export function FileLinkBadge({ linkId, paneId, compact }: FileLinkBadgeProps) {
  const [link, setLink] = useState<FileLinkResolved | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void call<FileLinkResolved | null>('link:resolve', { id: linkId }).then((r) => {
      setLink(r ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [linkId]);

  const handleClick = useCallback(() => {
    if (!link) return;
    if (!link.exists) {
      toastError(`Target no longer exists: ${link.targetPath}`);
      return;
    }
    if (link.targetKind === 'directory') {
      navigate(paneId, { kind: 'fs', path: link.targetPath });
    } else {
      void call('fs:open', { path: link.targetPath });
    }
  }, [link, paneId]);

  const handleDelete = useCallback(() => {
    if (!link) return;
    void call('link:delete', { id: link.id }).then(() => {
      toast({ level: 'info', title: 'Link removed' });
    }).catch(toastError);
  }, [link]);

  if (loading || !link) return null;

  const isBroken = !link.exists;

  if (compact) {
    return (
      <span
        className={`file-link-badge-compact ${isBroken ? 'is-broken' : ''}`}
        title={isBroken ? `Broken link: ${link.targetPath}` : `Link to ${link.targetPath}`}
        onClick={handleClick}
      >
        <Icon name={isBroken ? 'link-2-off' : 'link-2'} size={12} />
      </span>
    );
  }

  return (
    <div className={`file-link-badge ${isBroken ? 'is-broken' : ''}`}>
      <button className="file-link-target" onClick={handleClick} title={link.targetPath}>
        <Icon name={isBroken ? 'link-2-off' : 'link-2'} size={14} />
        <span className="ellipsis">
          {isBroken ? 'Broken link' : link.targetPath}
        </span>
      </button>
      <button className="file-link-remove icon-btn" onClick={handleDelete} aria-label="Remove link" data-tip="Remove link">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  File Links List Panel                                                      */
/*  Lists all file links in a given directory.                                 */
/* -------------------------------------------------------------------------- */

export interface FileLinksListProps {
  parentPath: string;
  paneId: string;
}

export function FileLinksList({ parentPath, paneId }: FileLinksListProps) {
  const [links, setLinks] = useState<FileLinkResolved[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void call<FileLinkResolved[]>('link:list', { parentPath }).then((r) => {
      setLinks(r ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [parentPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = useCallback(async () => {
    const picked = await call<string | null>('fs:pickFile', { title: 'Choose link target' });
    if (!picked) return;
    const name = picked.split('/').pop() ?? picked;
    try {
      await call('link:create', { name, targetPath: picked, parentPath });
      toast({ level: 'info', title: 'Link created' });
      refresh();
    } catch (err) {
      toastError(err);
    }
  }, [parentPath, refresh]);

  const handleResolve = useCallback((link: FileLinkResolved) => {
    if (!link.exists) {
      toastError(`Target no longer exists: ${link.targetPath}`);
      return;
    }
    if (link.targetKind === 'directory') {
      navigate(paneId, { kind: 'fs', path: link.targetPath });
    } else {
      void call('fs:open', { path: link.targetPath });
    }
  }, [paneId]);

  const handleDelete = useCallback((id: string) => {
    void call('link:delete', { id }).then(() => {
      toast({ level: 'info', title: 'Link removed' });
      refresh();
    }).catch(toastError);
  }, [refresh]);

  return (
    <div className="file-links-panel">
      <div className="file-links-header">
        <span className="file-links-title">File Links</span>
        <button className="icon-btn" onClick={handleCreate} aria-label="Create link" data-tip="Create link">
          <Icon name="plus" size={14} />
        </button>
      </div>
      {loading && <div className="file-links-loading">Loading...</div>}
      {!loading && links.length === 0 && (
        <div className="file-links-empty">No links in this folder</div>
      )}
      {!loading && links.map((link) => (
        <div key={link.id} className={`file-link-item ${!link.exists ? 'is-broken' : ''}`}>
          <button className="file-link-entry" onClick={() => handleResolve(link)} title={link.targetPath}>
            <Icon name={!link.exists ? 'link-2-off' : link.targetKind === 'directory' ? 'folder' : 'file'} size={14} />
            <span className="file-link-name ellipsis">{link.name}</span>
            {!link.exists && <span className="file-link-broken-label">Broken</span>}
          </button>
          <button className="icon-btn file-link-delete" onClick={() => handleDelete(link.id)} aria-label="Remove" data-tip="Remove link">
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
