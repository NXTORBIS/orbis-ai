import React, { useEffect, useState } from 'react';
import { call } from '../../api';
import { toastError } from '../../state/app';
import { navigate, activePane } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { EmptyState, ProgressBar } from '../../ui/components';
import { formatBytes, formatDate } from '../../ui/format';
import { runCommand } from '../../commands';
import type { DashboardData, DashboardDrive, DashboardPin, DashboardRecent } from '../../../shared/dashboard';

/* ────────────────────────────── search bar ───────────────────────────────── */

function QuickSearch() {
  return (
    <button
      type="button"
      className="dashboard-search"
      onClick={() => void runCommand('app.switcher')}
    >
      <Icon name="search" size={15} />
      <span className="muted">Quick navigation (Ctrl+P)</span>
    </button>
  );
}

/* ────────────────────────────── quick actions ────────────────────────────── */

function QuickActions() {
  return (
    <div className="dashboard-actions">
      <button type="button" className="dashboard-action-btn" onClick={() => void runCommand('file.newFolder')}>
        <Icon name="folderPlus" size={20} />
        <span>New folder</span>
      </button>
      <button type="button" className="dashboard-action-btn" onClick={() => void runCommand('terminal.open')}>
        <Icon name="terminal" size={20} />
        <span>Terminal</span>
      </button>
      <button type="button" className="dashboard-action-btn" onClick={() => void navigate(activePane().id, { kind: 'tool', tool: 'settings' })}>
        <Icon name="settings" size={20} />
        <span>Settings</span>
      </button>
      <button type="button" className="dashboard-action-btn" onClick={() => void navigate(activePane().id, { kind: 'tool', tool: 'diskUsage' })}>
        <Icon name="storage" size={20} />
        <span>Disk usage</span>
      </button>
    </div>
  );
}

/* ────────────────────────────── recent items ─────────────────────────────── */

function RecentItems({ recents, paneId }: { recents: DashboardRecent[]; paneId: string }) {
  const files = recents.filter((r) => r.kind === 'file' && r.exists).slice(0, 12);
  const folders = recents.filter((r) => r.kind === 'directory' && r.exists).slice(0, 8);

  if (!files.length && !folders.length) {
    return <EmptyState icon="clock" title="No recent items" body="Files and folders you open will appear here." />;
  }

  return (
    <div className="dashboard-recents">
      {folders.length > 0 && (
        <div className="dashboard-section">
          <h3>Recent folders</h3>
          <div className="dashboard-folder-grid">
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="dashboard-folder-card"
                onClick={() => void navigate(paneId, { kind: 'fs', path: f.path })}
                title={f.path}
              >
                <Icon name="folder" size={20} />
                <span className="dashboard-folder-name">{f.name}</span>
                <span className="dashboard-folder-date muted small">{formatDate(f.lastMs)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="dashboard-section">
          <h3>Recent files</h3>
          <div className="dashboard-file-list">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                className="dashboard-file-row"
                onClick={() => void call('fs:open', { path: f.path })}
                title={f.path}
              >
                <Icon name="file" size={16} />
                <span className="dashboard-file-name">{f.name}</span>
                <span className="dashboard-file-date muted small">{formatDate(f.lastMs)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── pinned locations ─────────────────────────── */

function PinnedLocations({ pins, paneId }: { pins: DashboardPin[]; paneId: string }) {
  if (!pins.length) return null;
  return (
    <div className="dashboard-section">
      <h3>Pinned</h3>
      <div className="dashboard-folder-grid">
        {pins.map((p) => (
          <button
            key={p.path}
            type="button"
            className="dashboard-folder-card is-pinned"
            onClick={() => void navigate(paneId, { kind: 'fs', path: p.path })}
            title={p.path}
          >
            <Icon name="pin" size={16} />
            <span className="dashboard-folder-name">{p.label ?? p.path.split(/[\\/]/).pop() ?? p.path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────── drives overview ─────────────────────────── */

function DrivesOverview({ drives, paneId }: { drives: DashboardDrive[]; paneId: string }) {
  if (!drives.length) return null;
  return (
    <div className="dashboard-section">
      <h3>Storage</h3>
      <div className="dashboard-drives">
        {drives.map((d) => {
          const used = d.totalBytes - d.freeBytes;
          const pct = d.totalBytes > 0 ? (used / d.totalBytes) * 100 : 0;
          return (
            <button
              key={d.mountpoint}
              type="button"
              className="dashboard-drive-card"
              onClick={() => void navigate(paneId, { kind: 'fs', path: d.mountpoint })}
              title={d.mountpoint}
            >
              <div className="dashboard-drive-header">
                <Icon name="drive" size={18} />
                <span className="dashboard-drive-name">{d.name}</span>
              </div>
              <ProgressBar value={pct / 100} label={`${d.name} usage`} />
              <div className="dashboard-drive-meta muted small">
                {formatBytes(d.freeBytes)} free of {formatBytes(d.totalBytes)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────── main view ────────────────────────────────── */

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function DashboardView({ paneId }: { paneId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call<DashboardData>('dashboard:data', {}).then(
      (d) => { if (!cancelled) { setData(d); setLoading(false); } },
      (err) => { if (!cancelled) { setLoading(false); toastError(err, 'Failed to load dashboard'); } },
    );
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="tool-view scroll-y dashboard-view">
      <header className="view-header dashboard-hero">
        <span className="hero-orb" aria-hidden="true" />
        <p className="hero-kicker">{greeting(new Date())}</p>
        <h1>Dashboard</h1>
      </header>

      <QuickSearch />
      <QuickActions />

      {loading && (
        <div className="dashboard-loading">
          <ProgressBar label="Loading dashboard" />
        </div>
      )}

      {data && (
        <>
          <PinnedLocations pins={data.pinned} paneId={paneId} />
          <RecentItems recents={data.recents} paneId={paneId} />
          <DrivesOverview drives={data.drives} paneId={paneId} />
        </>
      )}
    </div>
  );
}
