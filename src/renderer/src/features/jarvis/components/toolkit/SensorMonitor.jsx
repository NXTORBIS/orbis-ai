import { useEffect, useRef, useState } from 'react';
import { Gauge, Activity } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Unsupported } from './shared';

export default function SensorMonitor() {
  const [acc, setAcc] = useState(null);
  const [gyro, setGyro] = useState(null);
  const [mag, setMag] = useState(null);
  const [orient, setOrient] = useState(null);
  const [light, setLight] = useState(null);
  const [battery, setBattery] = useState(null);
  const [net, setNet] = useState(null);
  const [perm, setPerm] = useState('idle');
  const [status, setStatus] = useState({});
  const handlers = useRef({});

  const setSensor = (key) => (e) => {
    const fn = { acc: () => setAcc({ x: e.accelerationIncludingGravity?.x, y: e.accelerationIncludingGravity?.y, z: e.accelerationIncludingGravity?.z }), gyro: () => setGyro({ a: e.alpha, b: e.beta, g: e.gamma }), mag: () => setMag({ x: e.x, y: e.y, z: e.z }), orient: () => setOrient({ a: e.alpha, b: e.beta, g: e.gamma }) }[key];
    if (fn) fn();
  };

  const start = async () => {
    const s = {};
    if ('DeviceMotionEvent' in window) {
      try { if (typeof DeviceMotionEvent.requestPermission === 'function') { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') { s.acc = 'denied'; } } } catch { s.acc = 'denied'; }
      const h = setSensor('acc'); window.addEventListener('devicemotion', h); handlers.current.acc = h; s.acc = s.acc || 'on';
    } else s.acc = 'unsupported';
    if ('DeviceOrientationEvent' in window) {
      try { if (typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { s.orient = 'denied'; } } } catch { s.orient = 'denied'; }
      const h = setSensor('orient'); window.addEventListener('deviceorientation', h); handlers.current.orient = h; s.orient = s.orient || 'on';
    } else s.orient = 'unsupported';
    try {
      const G = window.Gyroscope; if (G) { const g = new G({ frequency: 10 }); g.addEventListener('reading', () => setGyro({ x: g.x, y: g.y, z: g.z })); g.start(); handlers.current.gyro = g; s.gyro = 'on'; } else s.gyro = 'unsupported';
    } catch { s.gyro = 'unsupported'; }
    try {
      const M = window.Magnetometer; if (M) { const m = new M({ frequency: 10 }); m.addEventListener('reading', () => setMag({ x: m.x, y: m.y, z: m.z })); m.start(); handlers.current.mag = m; s.mag = 'on'; } else s.mag = 'unsupported';
    } catch { s.mag = 'unsupported'; }
    try {
      const A = window.AmbientLightSensor; if (A) { const a = new A({ frequency: 5 }); a.addEventListener('reading', () => setLight(a.illuminance)); a.start(); handlers.current.light = a; s.light = 'on'; } else s.light = 'unsupported';
    } catch { s.light = 'unsupported'; }
    if (navigator.getBattery) navigator.getBattery().then((b) => { const upd = () => setBattery({ level: b.level, charging: b.charging }); upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); handlers.current.battery = upd; s.battery = 'on'; }); else s.battery = 'unsupported';
    if (navigator.connection) { const upd = () => setNet({ type: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt }); upd(); navigator.connection.addEventListener('change', upd); handlers.current.net = upd; s.net = 'on'; } else s.net = 'unsupported';
    setStatus(s); setPerm('granted');
  };

  useEffect(() => () => {
    Object.entries(handlers.current).forEach(([k, h]) => {
      if (k === 'acc' || k === 'orient') window.removeEventListener(k === 'acc' ? 'devicemotion' : 'deviceorientation', h);
      else if (k === 'net' && navigator.connection) navigator.connection.removeEventListener('change', h);
      else if (k === 'battery') {}
      else try { h.stop?.(); } catch {}
    });
  }, []);

  const Row = ({ label, data, unit, statusKey }) => (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        {status[statusKey] === 'unsupported' ? <span className="text-[10px] text-amber-500">unsupported</span> : status[statusKey] === 'denied' ? <span className="text-[10px] text-red-500">denied</span> : <Activity className="h-3 w-3 text-cyan-j" />}
      </div>
      {data ? <div className="mt-1 font-mono-j text-xs">{Object.entries(data).map(([k, v]) => `${k}: ${v != null ? v.toFixed(2) : '—'}`).join('  ')}</div> : <div className="mt-1 text-[11px] text-muted-foreground">{unit || 'waiting for data…'}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <ToolHeader icon={Gauge} title="Device Sensor Monitor" desc="Live readings from accelerometer, gyroscope, magnetometer, orientation, ambient light, battery and network." />
      {perm !== 'granted' && <Button size="sm" onClick={start} className="gap-1.5"><Activity className="h-4 w-4" /> Start sensors</Button>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Row label="Accelerometer" data={acc} statusKey="acc" unit="m/s²" />
        <Row label="Gyroscope" data={gyro} statusKey="gyro" unit="rad/s" />
        <Row label="Magnetometer" data={mag} statusKey="mag" unit="µT" />
        <Row label="Orientation" data={orient} statusKey="orient" unit="°" />
        <Row label="Ambient Light" data={light != null ? { lux: light } : null} statusKey="light" unit="lux" />
        <div className="rounded-lg border border-border/70 bg-card/60 p-3">
          <div className="flex items-center justify-between"><span className="text-xs font-medium">Battery</span>{status.battery === 'unsupported' ? <span className="text-[10px] text-amber-500">unsupported</span> : <Activity className="h-3 w-3 text-cyan-j" />}</div>
          {battery ? <div className="mt-1 font-mono-j text-xs">{Math.round(battery.level * 100)}% — {battery.charging ? 'charging' : 'on battery'}</div> : <div className="mt-1 text-[11px] text-muted-foreground">waiting…</div>}
        </div>
        <div className="rounded-lg border border-border/70 bg-card/60 p-3">
          <div className="flex items-center justify-between"><span className="text-xs font-medium">Network</span>{status.net === 'unsupported' ? <span className="text-[10px] text-amber-500">unsupported</span> : <Activity className="h-3 w-3 text-cyan-j" />}</div>
          {net ? <div className="mt-1 font-mono-j text-xs">{net.type} · {net.downlink} Mbps · {net.rtt}ms</div> : <div className="mt-1 text-[11px] text-muted-foreground">waiting…</div>}
        </div>
      </div>
      {perm === 'granted' && Object.values(status).every((v) => v === 'unsupported') && <Unsupported msg="No device sensors are available on this device/browser." />}
    </div>
  );
}