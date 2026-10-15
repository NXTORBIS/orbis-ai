import React, { useState, useEffect } from 'react';
import { Icon } from '../../ui/Icon';
import { call } from '../../api';

interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataPath: string;
}

interface Snapshot {
  innerWidth: number;
  innerHeight: number;
  dpr: number;
}

const PLATFORM_NAMES: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
};

function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function parseUserAgent(ua: string): { browser: string; os: string } {
  const browser =
    /Electron\/([\d.]+)/.exec(ua) ? `Electron ${/Electron\/([\d.]+)/.exec(ua)![1]}` :
    /Edg\/([\d.]+)/.exec(ua) ? `Edge ${/Edg\/([\d.]+)/.exec(ua)![1]}` :
    /Chrome\/([\d.]+)/.exec(ua) ? `Chrome ${/Chrome\/([\d.]+)/.exec(ua)![1]}` :
    /Firefox\/([\d.]+)/.exec(ua) ? `Firefox ${/Firefox\/([\d.]+)/.exec(ua)![1]}` :
    /Version\/([\d.]+).*Safari/.exec(ua) ? `Safari ${/Version\/([\d.]+)/.exec(ua)![1]}` :
    'Unknown';
  const os =
    /Windows NT ([\d.]+)/.exec(ua) ? `Windows (NT ${/Windows NT ([\d.]+)/.exec(ua)![1]})` :
    /Mac OS X ([\d_.]+)/.exec(ua) ? `macOS ${/Mac OS X ([\d_.]+)/.exec(ua)![1]!.replace(/_/g, '.')}` :
    /Linux/.test(ua) ? 'Linux' :
    'Unknown';
  return { browser, os };
}

function readSnapshot(): Snapshot {
  return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio };
}

function readMemory(): { used: number; total: number; limit?: number } | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit?: number } }).memory;
  if (!mem) return null;
  return { used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="system-info-row">
      <span className="system-info-label muted small">{label}</span>
      <span className="system-info-value">{value}</span>
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="system-info-section">
      <h2><Icon name={icon} size={15} /> {title}</h2>
      {children}
    </section>
  );
}

export function SystemInfoView() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState<Snapshot>(readSnapshot);
  const [mem, setMem] = useState(readMemory);
  const [uptime, setUptime] = useState(() => performance.now());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setInfo(await call<AppInfo>('app:info'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    setWin(readSnapshot());
    setMem(readMemory());
  };

  useEffect(() => {
    void load();
    const onResize = () => setWin(readSnapshot());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setUptime(performance.now());
      setMem(readMemory());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const ua = navigator.userAgent;
  const parsed = parseUserAgent(ua);
  const platformId = info?.platform ?? (window as unknown as { orbis?: { platform?: string } }).orbis?.platform ?? '';
  const platformName = PLATFORM_NAMES[platformId] ?? (platformId || 'Unknown');
  let timeZone = 'Unknown';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'; } catch { /* ignore */ }

  return (
    <div className="tool-view scroll-y system-info">
      <header className="view-header">
        <h1><Icon name="cpu" size={20} /> System Information</h1>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={15} />
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </header>

      {error && <p className="muted small">Could not load app info: {error}</p>}

      <Section icon="info" title="Application">
        <Row label="Name" value={info?.name ?? '…'} />
        <Row label="Version" value={info?.version ?? '…'} />
        <Row label="Electron" value={info?.electron ?? '…'} />
        <Row label="Chrome" value={info?.chrome ?? '…'} />
        <Row label="Node" value={info?.node ?? '…'} />
        <Row label="User data" value={<span className="small">{info?.userDataPath ?? '…'}</span>} />
      </Section>

      <Section icon="drive" title="Platform">
        <Row label="Operating system" value={platformName} />
        <Row label="Platform id" value={platformId || 'Unknown'} />
        <Row label="Detected OS" value={parsed.os} />
        <Row label="Engine" value={parsed.browser} />
      </Section>

      <Section icon="database" title="Memory (JS heap)">
        {mem ? (
          <>
            <Row label="Used" value={fmtBytes(mem.used)} />
            <Row label="Total" value={fmtBytes(mem.total)} />
            {mem.limit ? <Row label="Limit" value={fmtBytes(mem.limit)} /> : null}
          </>
        ) : (
          <p className="muted small">Memory information is not available.</p>
        )}
      </Section>

      <Section icon="settings" title="Window and screen">
        <Row label="Window" value={`${win.innerWidth} × ${win.innerHeight}`} />
        <Row label="Device pixel ratio" value={win.dpr} />
        <Row label="Screen" value={`${screen.width} × ${screen.height}`} />
        <Row label="Color depth" value={`${screen.colorDepth}-bit`} />
      </Section>

      <Section icon="globe" title="Locale">
        <Row label="Language" value={navigator.language} />
        <Row label="Time zone" value={timeZone} />
        <Row label="User agent" value={<span className="small">{ua}</span>} />
      </Section>

      <Section icon="clock" title="Session">
        <Row label="Uptime" value={fmtUptime(uptime)} />
      </Section>
    </div>
  );
}
