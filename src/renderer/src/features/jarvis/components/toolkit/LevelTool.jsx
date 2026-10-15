import { useEffect, useRef, useState } from 'react';
import { MoveDiagonal } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Unsupported } from './shared';

export default function LevelTool() {
  const [beta, setBeta] = useState(null);
  const [gamma, setGamma] = useState(null);
  const [perm, setPerm] = useState('idle');
  const [supported] = useState(() => 'DeviceOrientationEvent' in window);
  const handlerRef = useRef(null);

  const start = async () => {
    if (!supported) { setPerm('unsupported'); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { setPerm('denied'); return; }
      }
      setPerm('granted');
      const h = (e) => { if (e.beta != null) setBeta(e.beta); if (e.gamma != null) setGamma(e.gamma); };
      window.addEventListener('deviceorientation', h, true);
      handlerRef.current = h;
    } catch { setPerm('denied'); }
  };
  useEffect(() => () => { if (handlerRef.current) window.removeEventListener('deviceorientation', handlerRef.current, true); }, []);

  const horizLevel = gamma != null && Math.abs(gamma) < 1;
  const vertLevel = beta != null && Math.abs(Math.abs(beta) - 90) < 1;

  if (!supported) return <div className="space-y-4"><ToolHeader icon={MoveDiagonal} title="Level Tool" desc="Bubble level using device tilt." /><Unsupported /></div>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={MoveDiagonal} title="Level Tool" desc="Spirit level using the device orientation sensors. Place device flat for horizontal level." />
      {perm !== 'granted' && <Button size="sm" onClick={start}>Enable level</Button>}
      {perm === 'denied' && <Unsupported msg="Permission denied." />}
      <div className="flex flex-col items-center gap-6 py-4">
        <div className="relative h-40 w-64 overflow-hidden rounded-xl border-2 border-border bg-card/40">
          <div className="absolute left-1/2 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
          <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-j/40" />
          <div className="absolute h-3 w-3 rounded-full bg-cyan-j transition-all" style={{ left: `calc(50% + ${(gamma || 0) * 1.5}px)`, top: `calc(50% + ${(beta || 0) * 1.5}px)`, transform: 'translate(-50%, -50%)' }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Tilt X (γ)" value={gamma != null ? `${gamma.toFixed(1)}°` : '—'} mono />
          <Stat label="Tilt Y (β)" value={beta != null ? `${beta.toFixed(1)}°` : '—'} mono />
        </div>
        <div className="flex gap-3">
          <span className={`rounded-full px-3 py-1 text-xs ${horizLevel ? 'bg-green-500/20 text-green-600' : 'bg-secondary text-muted-foreground'}`}>Horizontal {horizLevel ? '✓ level' : ''}</span>
          <span className={`rounded-full px-3 py-1 text-xs ${vertLevel ? 'bg-green-500/20 text-green-600' : 'bg-secondary text-muted-foreground'}`}>Vertical {vertLevel ? '✓ level' : ''}</span>
        </div>
      </div>
    </div>
  );
}