import { useEffect, useState } from 'react';
import { Compass } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Unsupported } from './shared';

function headingLabel(h) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(h / 45) % 8];
}

export default function CompassTool() {
  const [heading, setHeading] = useState(null);
  const [perm, setPerm] = useState('idle');
  const [supported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);

  const start = async () => {
    if (!supported) { setPerm('unsupported'); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { setPerm('denied'); return; }
      }
      setPerm('granted');
      const handler = (e) => {
        let h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.alpha != null ? 360 - e.alpha : null);
        if (h != null) setHeading(((h % 360) + 360) % 360);
      };
      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
      window.__compassHandler = handler;
    } catch { setPerm('denied'); }
  };

  useEffect(() => () => {
    if (window.__compassHandler) {
      window.removeEventListener('deviceorientationabsolute', window.__compassHandler, true);
      window.removeEventListener('deviceorientation', window.__compassHandler, true);
      delete window.__compassHandler;
    }
  }, []);

  if (!supported || perm === 'unsupported') return (
    <div className="space-y-4"><ToolHeader icon={Compass} title="Compass" desc="Real device magnetometer heading." /><Unsupported msg="Device orientation is not available on this device/browser." /></div>
  );

  return (
    <div className="space-y-4">
      <ToolHeader icon={Compass} title="Compass" desc="Real device magnetometer heading. Requires permission on iOS." />
      {perm !== 'granted' && <Button size="sm" onClick={start} className="gap-1.5"><Compass className="h-4 w-4" /> Enable compass</Button>}
      {perm === 'denied' && <Unsupported msg="Permission denied. Enable motion/orientation access to use the compass." />}
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="relative h-56 w-56">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border border-border/50" style={{ transform: `rotate(${heading != null ? -heading : 0}deg)`, transition: 'transform 0.15s' }}>
            {['N', 'E', 'S', 'W'].map((d, i) => (
              <div key={d} className="absolute text-sm font-bold" style={{
                left: '50%', top: '50%',
                transform: `rotate(${i * 90}deg) translateY(-104px) rotate(${-i * 90}deg) translateX(-50%)`,
                color: d === 'N' ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))',
              }}>{d}</div>
            ))}
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-j" />
            <div className="absolute left-1/2 top-1/2 h-20 w-1 -translate-x-1/2 -translate-y-full -translate-y-2 bg-gradient-to-t from-transparent to-red-500" style={{ transformOrigin: 'bottom' }} />
            <div className="absolute left-1/2 top-1/2 h-20 w-1 -translate-x-1/2 translate-y-2 bg-gradient-to-b from-transparent to-muted-foreground/40" style={{ transformOrigin: 'top' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Heading" value={heading != null ? `${Math.round(heading)}°` : '—'} mono />
          <Stat label="Direction" value={heading != null ? headingLabel(heading) : '—'} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Calibration: if the heading is unstable, move the device in a figure-8 motion. Some browsers only provide orientation on HTTPS with permission.</p>
    </div>
  );
}