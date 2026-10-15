import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../../api';
import { EmptyState, ErrorState, IconButton, Loading, Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatDate } from '../../ui/format';
import { toast, toastError, confirm } from '../../state/app';
import type { CloudProfile, CloudEntry } from '../../../shared/cloudMount';
import { CLOUD_DEFAULT_PORTS } from '../../../shared/cloudMount';

type Protocol = 'ftp' | 'sftp' | 'webdav';

interface ProfileForm {
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  password: string;
  basePath: string;
}

const emptyForm: ProfileForm = { name: '', protocol: 'sftp', host: '', port: 22, username: '', password: '', basePath: '/' };

export function CloudMountView() {
  const [profiles, setProfiles] = useState<CloudProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<CloudEntry[]>([]);
  const [browsePath, setBrowsePath] = useState('/');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await call<CloudProfile[]>('cloud:profiles', {});
      setProfiles(list);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveProfile = async () => {
    try {
      await call<CloudProfile>('cloud:saveProfile', {
        ...(editingId ? { id: editingId } : {}),
        name: form.name,
        protocol: form.protocol,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password || undefined,
        basePath: form.basePath,
      });
      toast({ level: 'success', title: editingId ? 'Profile updated.' : 'Profile saved.' });
      setEditing(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (e) { toastError(e); }
  };

  const deleteProfile = async (id: string) => {
    const ok = await confirm({ title: 'Delete profile', body: 'Delete this connection profile? This cannot be undone.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await call<{ ok: boolean }>('cloud:deleteProfile', { id });
      toast({ level: 'success', title: 'Profile deleted.' });
      if (browsing === id) { setBrowsing(null); setBrowseEntries([]); }
      await load();
    } catch (e) { toastError(e); }
  };

  const connect = async (profile: CloudProfile) => {
    try {
      const pwd = form.password || '';
      await call<{ connected: boolean }>('cloud:connect', { id: profile.id, password: pwd || undefined });
      setConnectedIds((s) => new Set(s).add(profile.id));
      toast({ level: 'success', title: `Connected to ${profile.name}.` });
    } catch (e) { toastError(e); }
  };

  const disconnect = async (id: string) => {
    try {
      await call<{ ok: boolean }>('cloud:disconnect', { id });
      setConnectedIds((s) => { const n = new Set(s); n.delete(id); return n; });
      if (browsing === id) { setBrowsing(null); setBrowseEntries([]); }
      toast({ level: 'info', title: 'Disconnected.' });
    } catch (e) { toastError(e); }
  };

  const browse = async (profileId: string, dir = '/') => {
    setBrowsing(profileId);
    setBrowsePath(dir);
    setBrowseLoading(true);
    setError(null);
    try {
      const entries = await call<CloudEntry[]>('cloud:listDir', { id: profileId, path: dir, showHidden: false });
      setBrowseEntries(entries);
    } catch (e) {
      setError(String(e));
      setBrowseEntries([]);
    }
    setBrowseLoading(false);
  };

  const download = async (profileId: string, remotePath: string) => {
    setTransferring(remotePath);
    try {
      const result = await call<{ localPath: string }>('cloud:download', { id: profileId, remotePath });
      toast({ level: 'success', title: `Downloaded to ${result.localPath}` });
    } catch (e) { toastError(e); }
    setTransferring(null);
  };

  const startEdit = (profile?: CloudProfile) => {
    if (profile) {
      setForm({
        name: profile.name,
        protocol: profile.protocol as Protocol,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: '',
        basePath: profile.basePath,
      });
      setEditingId(profile.id);
    } else {
      setForm(emptyForm);
      setEditingId(null);
    }
    setEditing(true);
  };

  const browsingProfile = profiles.find((p) => p.id === browsing);
  const pathParts = browsePath.split('/').filter(Boolean);

  if (loading) return <Loading label="Loading profiles..." />;

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1><Icon name="cloud" size={22} /> Cloud Storage</h1>
        <p style={{ color: 'var(--text-2)' }}>Connect to FTP, SFTP and WebDAV servers to browse and transfer files.</p>
      </header>

      {/* Connection profiles */}
      {!editing && !browsing && (
        <>
          <div className="section-head">
            <h2>Connection profiles</h2>
            <span className="spacer" />
            <Button size="sm" onClick={() => startEdit()}>
              <Icon name="plus" size={14} /> New profile
            </Button>
          </div>

          {profiles.length === 0 && (
            <EmptyState icon="cloud" title="No profiles" body="Add a connection profile to browse remote servers." />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {profiles.map((p) => {
              const isConnected = connectedIds.has(p.id);
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
                  padding: 'var(--sp-4) var(--sp-5)', borderRadius: 6,
                  border: '1px solid var(--glass-border)', background: 'var(--glass-bg)',
                  backdropFilter: 'blur(var(--glass-blur))',
                }}>
                  <Icon name="server" size={20} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                      {p.protocol.toUpperCase()} {p.host}:{p.port} {p.username ? `(${p.username})` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: '999px',
                    background: isConnected ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--bg-inset)',
                    color: isConnected ? 'var(--accent)' : 'var(--text-2)',
                  }}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                  {isConnected ? (
                    <>
                      <IconButton icon="folder" label="Browse" onClick={() => void browse(p.id, p.basePath)} />
                      <IconButton icon="close" label="Disconnect" onClick={() => void disconnect(p.id)} />
                    </>
                  ) : (
                    <IconButton icon="plug" label="Connect" onClick={() => void connect(p)} />
                  )}
                  <IconButton icon="edit" label="Edit" onClick={() => startEdit(p)} />
                  <IconButton icon="trash" label="Delete" onClick={() => void deleteProfile(p.id)} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Profile editor */}
      {editing && (
        <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <h2 style={{ margin: 0 }}>{editingId ? 'Edit profile' : 'New profile'}</h2>
          <label className="field"><span className="field-label">Name</span>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Server" />
          </label>
          <label className="field"><span className="field-label">Protocol</span>
            <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as Protocol, port: CLOUD_DEFAULT_PORTS[e.target.value] ?? form.port })}>
              <option value="sftp">SFTP</option>
              <option value="ftp">FTP</option>
              <option value="webdav">WebDAV</option>
            </select>
          </label>
          <label className="field"><span className="field-label">Host</span>
            <input type="text" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="files.example.com" />
          </label>
          <label className="field"><span className="field-label">Port</span>
            <input type="text" value={String(form.port)} onChange={(e) => setForm({ ...form, port: parseInt(e.target.value, 10) || form.port })} />
          </label>
          <label className="field"><span className="field-label">Username</span>
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="field"><span className="field-label">Password</span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="field"><span className="field-label">Base path</span>
            <input type="text" value={form.basePath} onChange={(e) => setForm({ ...form, basePath: e.target.value })} placeholder="/" />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <Button variant="primary" onClick={saveProfile} disabled={!form.name || !form.host}>Save</Button>
            <Button onClick={() => { setEditing(false); setEditingId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* File browser */}
      {browsing && browsingProfile && !editing && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
            <IconButton icon="back" label="Back to profiles" onClick={() => { setBrowsing(null); setBrowseEntries([]); }} />
            <Icon name="server" size={16} />
            <span style={{ fontWeight: 500 }}>{browsingProfile.name}</span>
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)' }}>
              {browsingProfile.protocol.toUpperCase()} {browsingProfile.host}
            </span>
          </div>

          {/* Breadcrumbs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void browse(browsing, '/')}>
              <Icon name="home" size={14} />
            </button>
            {pathParts.map((part, i) => (
              <React.Fragment key={i}>
                <Icon name="chevronRight" size={12} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void browse(browsing, '/' + pathParts.slice(0, i + 1).join('/'))}>
                  {part}
                </button>
              </React.Fragment>
            ))}
          </div>

          {browseLoading && <Loading label="Loading..." />}
          {error && <ErrorState title="Error" body={error} />}

          {!browseLoading && !error && browseEntries.length === 0 && (
            <EmptyState icon="folder" title="Empty" body="This directory is empty." />
          )}

          {!browseLoading && browseEntries.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '50%' }}>Name</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {browseEntries.map((entry) => (
                  <tr key={entry.path}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                        <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={16} />
                        {entry.kind === 'directory' ? (
                          <button type="button" className="btn btn-ghost" style={{ padding: 0, textAlign: 'left' }}
                            onClick={() => void browse(browsing, entry.path)}>
                            {entry.name}
                          </button>
                        ) : entry.name}
                      </span>
                    </td>
                    <td>{entry.size != null ? formatBytes(entry.size) : ''}</td>
                    <td>{entry.modifiedMs ? formatDate(entry.modifiedMs) : ''}</td>
                    <td className="row-actions">
                      {entry.kind === 'file' && (
                        <IconButton icon="download" label="Download" disabled={transferring === entry.path}
                          onClick={() => void download(browsing, entry.path)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
