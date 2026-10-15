import { useState } from 'react';
import { Mountain, Upload } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Unsupported } from './shared';

export default function AltitudeMeter() {
  const [alt, setAlt] = useState(null);
  const [acc, setAcc] = useState(null);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState(null);
  const [running, setRunning] = useState(false);
  const [unit, setUnit] = useState('m');
  const [supported] = useState(() => 'geolocation' in navigator);

  const start = () => {
    setErr(null); setRunning(true); setHistory([]);
    navigator.geolocation.getCurrentPosition((p) => {
      if (p.coords.altitude == null) { setErr('Altitude not available from this device GPS.'); setRunning(false); return; }
      setAlt(p.coords.altitude); setAcc(p.coords.altitudeAccuracy); setHistory((h) => [...h, p.coords.altitude]);
    }, (e) => { setErr(e.message); setRunning(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    const id = navigator.geolocation.watchPosition((p) => {
      if (p.coords.altitude != null) { setAlt(p.coords.altitude); setAcc(p.coords.altitudeAccuracy); setHistory((h) => [...h, p.coords.altitude].slice(-60)); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    return id;
  };

  if (!supported) return <div className="space-y-4"><ToolHeader icon={Mountain} title="Altitude Meter" desc="GPS-derived altitude." /><Unsupported /></div>;
  const conv = (m) => unit === 'ft' ? m * 3.28084 : m;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Mountain} title="Altitude Meter" desc="GPS-derived elevation with accuracy and session history. Many devices do not report altitude." />
      <div className="flex gap-2">
        {!running ? <Button size="sm" onClick={start}>Start</Button> : <Button size="sm" variant="outline" onClick={() => setRunning(false)}>Stop</Button>}
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"><option value="m">meters</option><option value="ft">feet</option></select>
      </div>
      {err && <Unsupported msg={err} />}
      <div className="rounded-xl border border-border/70 bg-card/50 p-6 text-center">
        <div className="font-mono-j text-5xl font-bold tabular-nums">{alt != null ? conv(alt).toFixed(1) : '—'}</div>
        <div className="text-sm text-muted-foreground">{unit === 'ft' ? 'feet' : 'meters'} above sea level</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Accuracy" value={acc != null ? `±${conv(acc).toFixed(0)} ${unit}` : 'N/A'} mono />
        <Stat label="Samples" value={history.length} mono />
      </div>
      {history.length > 1 && (
        <div><div className="mb-1 text-xs text-muted-foreground">Session history</div>
          <div className="flex h-20 items-end gap-px overflow-hidden rounded-md border border-border/70 bg-card/40 p-1">
            {history.map((a, i) => <div key={i} className="flex-1 bg-cyan-j/60" style={{ height: `${((a - Math.min(...history)) / (Math.max(...history) - Math.min(...history) || 1)) * 100}%` }} />)}
          </div>
        </div>
      )}
    </div>
  );
}