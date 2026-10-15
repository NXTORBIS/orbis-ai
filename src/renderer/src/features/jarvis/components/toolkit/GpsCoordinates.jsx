import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, CopyBtn, Unsupported } from './shared';

export default function GpsCoordinates() {
  const [pos, setPos] = useState(null);
  const [err, setErr] = useState(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'geolocation' in navigator);

  useEffect(() => () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current); }, []);

  const start = () => {
    if (!supported) return;
    setErr(null); setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setPos(p.coords),
      (e) => { setErr(e.message); setWatching(false); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  };
  const stop = () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current); setWatching(false); };

  if (!supported) return (
    <div className="space-y-4"><ToolHeader icon={MapPin} title="GPS Coordinates" desc="Live geolocation from the device." /><Unsupported /></div>
  );

  const lat = pos?.latitude, lon = pos?.longitude;
  const dms = (deg, isLat) => {
    if (deg == null) return '—';
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    const a = Math.abs(deg); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = ((a - d - m / 60) * 3600).toFixed(1);
    return `${d}° ${m}' ${s}" ${dir}`;
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={MapPin} title="GPS Coordinates" desc="Live latitude, longitude, altitude and accuracy from the device GPS." />
      <div className="flex gap-2">
        {!watching ? <Button size="sm" onClick={start} className="gap-1.5"><Navigation className="h-4 w-4" /> Start tracking</Button>
          : <Button size="sm" variant="destructive" onClick={stop}>Stop</Button>}
      </div>
      {err && <Unsupported msg={`Geolocation error: ${err}`} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Latitude" value={lat != null ? lat.toFixed(6) : '—'} mono />
        <Stat label="Longitude" value={lon != null ? lon.toFixed(6) : '—'} mono />
        <Stat label="Accuracy" value={pos?.accuracy != null ? `±${Math.round(pos.accuracy)} m` : '—'} />
        <Stat label="Altitude" value={pos?.altitude != null ? `${pos.altitude.toFixed(1)} m` : 'N/A'} />
        <Stat label="Heading" value={pos?.heading != null ? `${Math.round(pos.heading)}°` : 'N/A'} />
        <Stat label="Speed" value={pos?.speed != null ? `${(pos.speed * 3.6).toFixed(1)} km/h` : 'N/A'} />
      </div>
      {pos && (
        <div className="flex flex-wrap items-center gap-2">
          <CopyBtn value={`${lat.toFixed(6)}, ${lon.toFixed(6)}`} label="Copy lat,lon" />
          <CopyBtn value={dms(lat, true) + ' ' + dms(lon, false)} label="Copy DMS" />
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=16`} target="_blank" rel="noreferrer" className="text-xs text-cyan-j hover:underline">Open in map ↗</a>
        </div>
      )}
    </div>
  );
}