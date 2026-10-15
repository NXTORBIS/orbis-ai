import { useCallback, useEffect, useRef, useState } from 'react';
import { call, on } from '../../api';
import { toast, toastError } from '../../state/app';
import { activePane, navigate, ws } from '../../state/workspace';
import { useStore } from '../../state/store';
import { EmptyState } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import type { VolumeInfo, VolumesSnapshot } from '../../../shared/volumes';

/* ────────────────────── capacity bar ────────────────────── */

function CapacityBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const warn = pct > 90;
  const danger = pct > 95;
  return (
    <div className="volume-capacity-bar">
      <div
        className={`volume-capacity-fill ${danger ? 'danger' : warn ? 'warn' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ────────────────────── volume card ────────────────────── */

function VolumeCard({ vol, onNavigate, onEject }: { vol: VolumeInfo; onNavigate: () => void; onEject: () => void }) {
  return (
    <div className="volume-card">
      <div className="volume-card-header">
        <Icon name={vol.removable ? 'usb' : 'storage'} size={20} />
        <div className="volume-card-title">
          <span className="volume-card-name">{vol.label || vol.mountPath}</span>
          {vol.fsType && <span className="volume-card-fs">{vol.fsType}</span>}
        </div>
        <div className="volume-card-actions">
          <button type="button" className="btn btn-default btn-sm" onClick={onNavigate} title="Open volume">
            <Icon name="folder" size={14} /> <span>Open</span>
          </button>
          {vol.removable && (
            <button type="button" className="btn btn-default btn-sm" onClick={onEject} title="Eject volume">
              <Icon name="eject" size={14} /> <span>Eject</span>
            </button>
          )}
        </div>
      </div>
      <div className="volume-card-body">
        <CapacityBar used={vol.usedBytes} total={vol.totalBytes} />
        <div className="volume-card-stats">
          <span>{formatBytes(vol.usedBytes)} used</span>
          <span>{formatBytes(vol.freeBytes)} free</span>
          <span>{formatBytes(vol.totalBytes)} total</span>
        </div>
        <div className="volume-card-meta">
          <span className="volume-card-path">{vol.mountPath}</span>
          <span className="volume-card-pct">{vol.usedPercent}% used</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────── main view ────────────────────── */

export function VolumesView() {
  const pane = useStore(ws, activePane);
  const [snapshot, setSnapshot] = useState<VolumesSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await call<VolumesSnapshot>('volumes:snapshot');
      setSnapshot(snap);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    void refresh();
    timerRef.current = setInterval(() => void refresh(), 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  // Listen for volume change events
  useEffect(() => {
    const off = on('fs:volumesChanged', () => void refresh());
    return off;
  }, [refresh]);

  const handleNavigate = useCallback((mountPath: string) => {
    void navigate(pane.id, { kind: 'fs', path: mountPath });
  }, [pane.id]);

  const handleEject = useCallback(async (mountPath: string) => {
    try {
      const result = await call<{ success: boolean; message: string }>('volumes:eject', { mountPath });
      if (result.success) {
        toast({ level: 'success', title: result.message });
        void refresh();
      } else {
        toastError(new Error(result.message), 'Eject failed');
      }
    } catch (err) {
      toastError(err, 'Eject failed');
    }
  }, [refresh]);

  const volumes = snapshot?.volumes ?? [];
  const removable = volumes.filter((v) => v.removable);
  const fixed = volumes.filter((v) => !v.removable);

  return (
    <div className="tool-view scroll-y volumes-view">
      <header className="view-header">
        <h1><Icon name="storage" size={20} /> Mounted Volumes</h1>
        <span className="spacer" />
        <button type="button" className="btn btn-default btn-sm" onClick={() => void refresh()} disabled={loading}>
          <Icon name="refresh" size={14} /> <span>Refresh</span>
        </button>
      </header>

      {error && <p className="error-text">{error}</p>}

      {!snapshot && loading && <EmptyState icon="storage" title="Scanning volumes…" />}

      {snapshot && volumes.length === 0 && <EmptyState icon="storage" title="No mounted volumes found" />}

      {fixed.length > 0 && (
        <section className="volumes-section">
          <h2>Fixed drives</h2>
          <div className="volumes-grid">
            {fixed.map((v) => (
              <VolumeCard key={v.id} vol={v} onNavigate={() => handleNavigate(v.mountPath)} onEject={() => handleEject(v.mountPath)} />
            ))}
          </div>
        </section>
      )}

      {removable.length > 0 && (
        <section className="volumes-section">
          <h2>Removable drives</h2>
          <div className="volumes-grid">
            {removable.map((v) => (
              <VolumeCard key={v.id} vol={v} onNavigate={() => handleNavigate(v.mountPath)} onEject={() => handleEject(v.mountPath)} />
            ))}
          </div>
        </section>
      )}

      {snapshot && (
        <p className="volumes-timestamp">Last updated: {new Date(snapshot.timestampMs).toLocaleTimeString()}</p>
      )}
    </div>
  );
}
