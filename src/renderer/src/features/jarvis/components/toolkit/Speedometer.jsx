import { useEffect, useRef, useState } from 'react';
import { Gauge, Play, Square, RotateCcw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Unsupported } from './shared';

export default function Speedometer() {
  const [speed, setSpeed] = useState(null);
  const [max, setMax] = useState(0);
  const [avg, setAvg] = useState(0);
  const [dist, setDist] = useState(0);
  const [unit, setUnit] = useState('kmh');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [supported] = useState(() => 'geolocation' in navigator);
  const watchId = useRef(null);
  const samples = useRef([]);
  const lastPos = useRef(null);
  const lastTs = useRef(null);

  const factor = unit === 'kmh' ? 3.6 : unit === 'mph' ? 2.23694 : 1;
  const unitLabel = unit === 'kmh' ? 'km/h' : unit === 'mph' ? 'mph' : 'm/s';
  const fmt = (v) => v != null ? (v * factor).toFixed(1) : '—';

  const start = () => {
    setErr(null); setRunning(true); setMax(0); setAvg(0); setDist(0); samples.current = []; lastPos.current = null;
    watchId.current = navigator.geolocation.watchPosition((p) => {
      const s = p.coords.speed != null ? p.coords.speed : null;
      if (s != null) { setSpeed(s); setMax((m) => Math.max(m, s)); samples.current.push(s); setAvg(samples.current.reduce((a, b) => a + b, 0) / samples.current.length); }
      if (lastPos.current && p.coords.latitude != null) {
        const d = haversine(lastPos.current.lat, lastPos.current.lon, p.coords.latitude, p.coords.longitude);
        setDist((x) => x + d);
      }
      lastPos.current = { lat: p.coords.latitude, lon: p.coords.longitude }; lastTs.current = Date.now();
    }, (e) => { setErr(e.message); setRunning(false); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  };
  const stop = () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current); setRunning(false); setSpeed(null); };
  useEffect(() => () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current); }, []);

  if (!supported) return <div className="space-y-4"><ToolHeader icon={Gauge} title="Speedometer" desc="GPS-based speed tracking." /><Unsupported /></div>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Gauge} title="Speedometer" desc="GPS-based current, maximum and average speed with distance traveled." />
      <div className="flex flex-wrap gap-2">
        {!running ? <Button size="sm" onClick={start} className="gap-1.5"><Play className="h-4 w-4" /> Start</Button> : <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button>}
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"><option value="kmh">km/h</option><option value="mph">mph</option><option value="ms">m/s</option></select>
      </div>
      {err && <Unsupported msg={err} />}
      <div className="rounded-xl border border-border/70 bg-card/50 p-6 text-center">
        <div className="font-mono-j text-6xl font-bold tabular-nums">{fmt(speed)}</div>
        <div className="text-sm text-muted-foreground">{unitLabel}</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Max" value={fmt(max)} mono />
        <Stat label="Average" value={fmt(avg)} mono />
        <Stat label="Distance" value={`${(dist / (unit === 'mph' ? 1609.34 : unit === 'kmh' ? 1000 : 1)).toFixed(2)} ${unit === 'ms' ? 'm' : unit === 'mph' ? 'mi' : 'km'}`} mono />
      </div>
    </div>
  );
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}