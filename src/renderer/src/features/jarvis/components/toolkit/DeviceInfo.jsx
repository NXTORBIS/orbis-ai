import { useEffect, useState } from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Panel, CopyBtn, fmtBytes } from './shared';

const rows = (title, items) => ({ title, items });

export default function DeviceInfo() {
  const [battery, setBattery] = useState(null);
  const [storage, setStorage] = useState(null);
  const [copy, setCopy] = useState('');

  useEffect(() => {
    if (navigator.getBattery) {
      navigator.getBattery().then((b) => setBattery({ level: Math.round(b.level * 100), charging: b.charging })).catch(() => {});
    }
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => setStorage(e)).catch(() => {});
    }
  }, []);

  const nav = navigator;
  const conn = nav.connection || {};
  const groups = [
    rows('Browser & system', [
      ['User agent', nav.userAgent],
      ['Platform', nav.userAgentData?.platform || nav.platform || 'not exposed'],
      ['Language', nav.language],
      ['All languages', (nav.languages || []).join(', ')],
      ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
      ['Cookies enabled', String(nav.cookieEnabled)],
      ['Online', String(nav.onLine)],
      ['Do Not Track', nav.doNotTrack || 'not set'],
    ]),
    rows('Screen & display', [
      ['Screen', `${screen.width} × ${screen.height}`],
      ['Available area', `${screen.availWidth} × ${screen.availHeight}`],
      ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
      ['Pixel ratio', String(window.devicePixelRatio)],
      ['Colour depth', `${screen.colorDepth}-bit`],
      ['Orientation', screen.orientation?.type || 'unknown'],
    ]),
    rows('Hardware & sensors', [
      ['CPU threads', nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : 'not exposed'],
      ['Device memory', nav.deviceMemory ? `${nav.deviceMemory} GB` : 'not exposed'],
      ['Touch points', String(nav.maxTouchPoints ?? 0)],
      ['Battery', battery ? `${battery.level}%${battery.charging ? ' · charging' : ''}` : 'not exposed'],
      ['Accelerometer', 'accelerometer' in window ? 'available' : 'not exposed'],
      ['Gyroscope', 'gyroscope' in window ? 'available' : 'not exposed'],
      ['Clipboard API', nav.clipboard ? 'available' : 'unavailable'],
      ['Share API', nav.share ? 'available' : 'unavailable'],
    ]),
    rows('Network & storage', [
      ['Connection type', conn.effectiveType ? `${conn.effectiveType.toUpperCase()}${conn.saveData ? ' · data saver' : ''}` : 'not exposed'],
      ['Downlink', conn.downlink ? `${conn.downlink} Mbps` : 'not exposed'],
      ['Round-trip time', conn.rtt ? `${conn.rtt} ms` : 'not exposed'],
      ['Storage used', storage?.usage ? fmtBytes(storage.usage) : 'not exposed'],
      ['Storage quota', storage?.quota ? fmtBytes(storage.quota) : 'not exposed'],
      ['Service worker', 'serviceWorker' in nav ? 'supported' : 'unsupported'],
    ]),
  ];

  const report = JSON.stringify(Object.fromEntries(groups.flatMap((g) => g.items)), null, 2);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Smartphone} title="Device & Browser Info" desc="Everything this device reveals about itself — useful for bug reports and support tickets." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setCopy(report)} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Build report</Button>
        <CopyBtn value={report} label="Copy full report" />
        {copy && <span className="text-xs text-muted-foreground">Report ready — {report.length} characters</span>}
      </div>
      {groups.map((g) => (
        <Panel key={g.title}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-j">{g.title}</div>
          <div className="divide-y divide-border/50">
            {g.items.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 py-1.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="max-w-[60%] break-words text-right font-mono-j text-xs">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}