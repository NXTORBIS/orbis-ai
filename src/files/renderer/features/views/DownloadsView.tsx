import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, Loading, Pill, Segmented, TextField, Toggle, useMenu, type MenuItem } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatDate } from '../../ui/format';
import { useStore } from '../../state/store';
import { toast, toastError, confirm } from '../../state/app';
import { activePane, navigate, parentPath } from '../../state/workspace';
import { openFile } from '../../actions';
import {
  downloads, initDownloads, loadDownloads,
  pauseDownload, resumeDownload, cancelDownload, retryDownload, removeDownload, clearDownloadHistory,
  updateDownloadSettings,
} from '../../state/downloads';
import { DownloadDialog } from '../DownloadDialog';
import type { DownloadRecord, DownloadProgressEvent, DownloadSettings } from '../../../shared/downloads';

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '--';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function statePill(state: string): React.ReactNode {
  const tone = state === 'completed' ? 'success'
    : state === 'failed' || state === 'cancelled' ? 'error'
    : state === 'downloading' ? 'accent'
    : state === 'paused' ? 'warning'
    : 'neutral';
  return <Pill tone={tone}>{state}</Pill>;
}

type Filter = 'all' | 'active' | 'completed' | 'failed';

export function DownloadsManagerView() {
  const { records, progress: progressMap, settings, loading } = useStore(downloads, (s) => s);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menu = useMenu();

  useEffect(() => { initDownloads(); }, []);

  const filtered = useMemo(() => {
    let list = records;
    switch (filter) {
      case 'active':
        list = list.filter((r) => ['queued', 'downloading', 'paused', 'verifying', 'extracting'].includes(r.state));
        break;
      case 'completed':
        list = list.filter((r) => r.state === 'completed');
        break;
      case 'failed':
        list = list.filter((r) => r.state === 'failed' || r.state === 'cancelled');
        break;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.filename.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
    }
    return list;
  }, [records, filter, search]);

  const activeCount = records.filter((r) => ['queued', 'downloading', 'paused', 'verifying', 'extracting'].includes(r.state)).length;

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Download Manager</h1>
        <p className="muted">Download files from the web. Supports pause and resume, concurrent downloads, checksum verification, and speed limiting.</p>
      </header>
      <div className="tool-controls">
        <Button variant="primary" icon="download" onClick={() => setShowDialog(true)}>New download</Button>
        <Segmented<Filter>
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${records.length})` },
            { value: 'active', label: `Active (${activeCount})` },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
        <TextField placeholder="Search downloads…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 180 }} />
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="settings" onClick={() => setShowSettings(true)} title="Download settings">Settings</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={async () => {
          if (await confirm({ title: 'Clear download history?', body: 'Completed, failed and cancelled downloads will be removed from the list. Files on disk are not deleted.', confirmLabel: 'Clear history' })) {
            await clearDownloadHistory().catch(toastError);
          }
        }}>Clear history</Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void loadDownloads()} title="Refresh list" />
      </div>
      {loading ? <Loading label="Loading downloads…" /> : !filtered.length ? (
        <EmptyState
          icon="download"
          title={filter === 'all' ? 'No downloads yet' : `No ${filter} downloads`}
          body="Click 'New download' to download a file from a URL."
        />
      ) : (
        <div className="download-list">
          {filtered.map((rec) => (
            <DownloadRow key={rec.id} record={rec} progress={progressMap[rec.id] ?? null} menu={menu} />
          ))}
        </div>
      )}
      {showDialog && <DownloadDialog onClose={() => setShowDialog(false)} />}
      {showSettings && settings && <SettingsDialog settings={settings} onClose={() => setShowSettings(false)} />}
      {menu.node}
    </div>
  );
}

function DownloadRow({ record: rec, progress, menu }: { record: DownloadRecord; progress: DownloadProgressEvent | null; menu: ReturnType<typeof useMenu> }) {
  const isActive = rec.state === 'downloading';
  const isPaused = rec.state === 'paused';
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(rec.state);
  const prog = progress;
  const fraction = prog?.fraction ?? (rec.totalBytes ? rec.bytesDownloaded / rec.totalBytes : null);

  const urlHost = (() => {
    try { return new URL(rec.url).hostname; } catch { return rec.url; }
  })();

  const actions: MenuItem[] = [
    ...(isActive ? [{ label: 'Pause', icon: 'pause', run: () => void pauseDownload(rec.id).catch(toastError) }] : []),
    ...(isPaused ? [{ label: 'Resume', icon: 'play', run: () => void resumeDownload(rec.id).catch(toastError) }] : []),
    ...(!isTerminal ? [{ label: 'Cancel', icon: 'close', run: () => void cancelDownload(rec.id).catch(toastError) }] : []),
    ...(rec.state === 'failed' || rec.state === 'cancelled' ? [{ label: 'Retry', icon: 'retry', run: () => void retryDownload(rec.id).catch(toastError) }] : []),
    ...(rec.state === 'completed' ? [
      { label: 'Open file', icon: 'open', run: () => void openFile(rec.filePath) },
      { label: 'Show in folder', icon: 'folderOpen', run: () => void navigate(activePane().id, { kind: 'fs', path: parentPath(rec.filePath)! }, { select: rec.filePath }) },
    ] : []),
    { label: 'Copy URL', icon: 'copy', run: () => void navigator.clipboard.writeText(rec.url).then(() => toast({ level: 'success', title: 'URL copied' })) },
    { label: '', separator: true },
    { label: 'Remove from list', icon: 'trash', danger: true, run: () => void removeDownload(rec.id).catch(toastError) },
  ];

  return (
    <div className={`download-row ${isActive ? 'is-active' : ''} ${rec.state === 'failed' ? 'is-failed' : ''}`}>
      <div className="download-icon">
        <Icon name={isActive ? 'download' : isPaused ? 'pause' : rec.state === 'completed' ? 'check' : rec.state === 'failed' ? 'error' : rec.state === 'queued' ? 'clock' : 'download'} size={20} />
      </div>
      <div className="download-info">
        <div className="download-name" title={rec.filePath}>{rec.filename}</div>
        <div className="download-meta muted small">
          <span className="mono" title={rec.url}>{urlHost}</span>
          {rec.totalBytes != null && <> · {formatBytes(rec.bytesDownloaded)} / {formatBytes(rec.totalBytes)}</>}
          {rec.totalBytes == null && rec.bytesDownloaded > 0 && <> · {formatBytes(rec.bytesDownloaded)}</>}
          {isActive && prog && <> · {formatSpeed(prog.speed)} · ETA {formatEta(prog.etaSec)}</>}
          {rec.checksumResult === 'match' && <> · <span className="success-text">Checksum verified</span></>}
          {rec.checksumResult === 'mismatch' && <> · <span className="warning-text">Checksum mismatch</span></>}
        </div>
        {(isActive || isPaused) && fraction != null && (
          <div className="download-progress">
            <div className="download-progress-bar" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
          </div>
        )}
        {rec.error && <div className="warning-text small">{rec.error}</div>}
      </div>
      <div className="download-status">
        {statePill(rec.state)}
        <span className="muted small tabular">{formatDate(rec.finishedMs ?? rec.startedMs ?? rec.createdMs)}</span>
      </div>
      <div className="download-actions">
        {isActive && <Button size="sm" variant="ghost" icon="pause" title="Pause" onClick={() => void pauseDownload(rec.id).catch(toastError)} />}
        {isPaused && <Button size="sm" variant="ghost" icon="play" title="Resume" onClick={() => void resumeDownload(rec.id).catch(toastError)} />}
        {!isTerminal && !isActive && !isPaused && rec.state === 'queued' && <Button size="sm" variant="ghost" icon="close" title="Cancel" onClick={() => void cancelDownload(rec.id).catch(toastError)} />}
        {(rec.state === 'failed' || rec.state === 'cancelled') && <Button size="sm" variant="ghost" icon="retry" title="Retry" onClick={() => void retryDownload(rec.id).catch(toastError)} />}
        {rec.state === 'completed' && <Button size="sm" variant="ghost" icon="open" title="Open file" onClick={() => void openFile(rec.filePath)} />}
        <Button size="sm" variant="ghost" icon="more" title="More actions" onClick={(e) => menu.open(actions, e.clientX, e.clientY)} />
      </div>
    </div>
  );
}

function SettingsDialog({ settings, onClose }: { settings: DownloadSettings; onClose: () => void }) {
  const [s, setS] = useState({ ...settings });
  return (
    <Dialog title="Download settings" onClose={onClose} width={460} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          await updateDownloadSettings(s).catch(toastError);
          toast({ level: 'success', title: 'Settings saved' });
          onClose();
        }}>Save</Button>
      </>
    }>
      <div className="form">
        <label className="field">
          <span className="field-label">Max concurrent downloads</span>
          <input type="number" className="input narrow" min={1} max={8} value={s.maxConcurrent} onChange={(e) => setS({ ...s, maxConcurrent: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
        </label>
        <label className="field">
          <span className="field-label">Global speed limit (KB/s, 0 = unlimited)</span>
          <input type="number" className="input narrow" min={0} max={1000000} value={s.speedLimitKBs} onChange={(e) => setS({ ...s, speedLimitKBs: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <Toggle id="dl-auto-extract" label="Auto-extract archives by default" checked={s.autoExtract} onChange={(autoExtract) => setS({ ...s, autoExtract })} />
      </div>
    </Dialog>
  );
}
