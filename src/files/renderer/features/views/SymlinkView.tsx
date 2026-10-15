import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, currentLocation } from '../../state/workspace';
import { Button, EmptyState, Pill, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { SymlinkInfo } from '../../../shared/symlinks';

export function SymlinkView() {
  const pane = useStore(ws, activePane);
  const loc = currentLocation(pane);
  const dir = loc.kind === 'fs' ? loc.path : undefined;

  const [links, setLinks] = useState<SymlinkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [fixTarget, setFixTarget] = useState<{ path: string; current: string } | null>(null);
  const [newTarget, setNewTarget] = useState('');

  const scan = useCallback(async () => {
    if (!dir) return;
    setLoading(true);
    try {
      const result = await call<SymlinkInfo[]>('symlink:scan', { path: dir, recursive });
      setLinks(result);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [dir, recursive]);

  useEffect(() => { void scan(); }, [scan]);

  const handleDelete = useCallback(async (p: string) => {
    try {
      await call('symlink:delete', { path: p });
      toast({ level: 'success', title: 'Symlink removed' });
      void scan();
    } catch (err) {
      toastError(err);
    }
  }, [scan]);

  const handleConvert = useCallback(async (p: string, toRelative: boolean) => {
    try {
      await call('symlink:convert', { path: p, toRelative });
      toast({ level: 'success', title: toRelative ? 'Converted to relative' : 'Converted to absolute' });
      void scan();
    } catch (err) {
      toastError(err);
    }
  }, [scan]);

  const handleFix = useCallback(async () => {
    if (!fixTarget || !newTarget) return;
    try {
      await call('symlink:fixBroken', { path: fixTarget.path, newTarget });
      toast({ level: 'success', title: 'Symlink re-pointed' });
      setFixTarget(null);
      setNewTarget('');
      void scan();
    } catch (err) {
      toastError(err);
    }
  }, [fixTarget, newTarget, scan]);

  const broken = useMemo(() => links.filter((l) => !l.exists), [links]);
  const valid = useMemo(() => links.filter((l) => l.exists), [links]);

  if (!dir) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Symbolic Links</h1></header>
        <EmptyState icon="link" title="Navigate to a folder" body="Open a directory to scan for symbolic links." />
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Symbolic Links</h1>
        <div className="view-actions">
          <label className="symlink-checkbox">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
            <span>Recursive</span>
          </label>
          <Button size="sm" onClick={scan} disabled={loading}>{loading ? 'Scanning...' : 'Scan'}</Button>
          <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>Create symlink</Button>
        </div>
      </header>

      {broken.length > 0 && (
        <section className="symlink-section">
          <h2 className="symlink-section-title error-text"><Icon name="warning" size={16} /> Broken links ({broken.length})</h2>
          <div className="symlink-table">
            <div className="symlink-row symlink-header">
              <span>Name</span><span>Target</span><span>Type</span><span>Actions</span>
            </div>
            {broken.map((link) => (
              <div key={link.path} className="symlink-row symlink-broken">
                <span className="ellipsis mono" title={link.path}>{link.path.split('/').pop()}</span>
                <span className="ellipsis mono error-text" title={link.target}>{link.target}</span>
                <Pill tone="error">broken</Pill>
                <span className="symlink-actions">
                  <Button size="sm" onClick={() => { setFixTarget({ path: link.path, current: link.target }); setNewTarget(''); }}>Fix</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(link.path)}>Delete</Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {valid.length > 0 && (
        <section className="symlink-section">
          <h2 className="symlink-section-title">Valid links ({valid.length})</h2>
          <div className="symlink-table">
            <div className="symlink-row symlink-header">
              <span>Name</span><span>Target</span><span>Type</span><span>Path type</span><span>Actions</span>
            </div>
            {valid.map((link) => (
              <div key={link.path} className="symlink-row">
                <span className="ellipsis mono" title={link.path}>{link.path.split('/').pop()}</span>
                <span className="ellipsis mono" title={link.target}>{link.target}</span>
                <Pill>{link.kind}</Pill>
                <Pill>{link.isRelative ? 'relative' : 'absolute'}</Pill>
                <span className="symlink-actions">
                  <Button size="sm" variant="ghost" onClick={() => handleConvert(link.path, !link.isRelative)}>
                    {link.isRelative ? 'To absolute' : 'To relative'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setFixTarget({ path: link.path, current: link.target }); setNewTarget(''); }}>Retarget</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(link.path)}>Delete</Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && links.length === 0 && (
        <EmptyState icon="link" title="No symlinks found" body="This directory does not contain any symbolic links." />
      )}

      {showCreate && <CreateSymlinkDialog dir={dir} onClose={() => setShowCreate(false)} onCreated={scan} />}

      {fixTarget && (
        <div className="symlink-fix-dialog">
          <h3>Re-point symlink</h3>
          <p className="muted small">Current target: <code>{fixTarget.current}</code></p>
          <TextField label="New target" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="/path/to/target" autoFocus />
          <div className="symlink-fix-actions">
            <Button size="sm" onClick={() => setFixTarget(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={handleFix} disabled={!newTarget.trim()}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSymlinkDialog({ dir, onClose, onCreated }: { dir: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [relative, setRelative] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !target.trim()) return;
    setCreating(true);
    try {
      const linkPath = dir + '/' + name.trim();
      await call('symlink:create', { path: linkPath, target: target.trim(), relative });
      toast({ level: 'success', title: 'Symlink created' });
      onClose();
      onCreated();
    } catch (err) {
      toastError(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="symlink-fix-dialog">
      <h3>Create symbolic link</h3>
      <TextField label="Link name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-link" autoFocus />
      <TextField label="Target path" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="/path/to/target" />
      <label className="symlink-checkbox">
        <input type="checkbox" checked={relative} onChange={(e) => setRelative(e.target.checked)} />
        <span>Store as relative path</span>
      </label>
      <div className="symlink-fix-actions">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={handleCreate} disabled={creating || !name.trim() || !target.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
