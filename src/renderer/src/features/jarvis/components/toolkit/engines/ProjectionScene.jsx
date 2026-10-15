import { useMemo, useRef, useState } from 'react';
import { Button } from '@jarvis/components/ui/button';

export default function ProjectionScene({ points = [], lines = [], faces = [], onSelect, selected, label }) {
  const [yaw, setYaw] = useState(0.45), [pitch, setPitch] = useState(0.25), [zoom, setZoom] = useState(1), drag = useRef(null);
  const project = useMemo(() => {
    const all = [...points.map(p => p.p), ...lines.flatMap(l => l.points), ...faces.flatMap(f => f.points)];
    const lo = [0, 1, 2].map(i => Math.min(0, ...all.map(p => p[i] || 0))), hi = [0, 1, 2].map(i => Math.max(0, ...all.map(p => p[i] || 0)));
    const ctr = lo.map((v, i) => (v + hi[i]) / 2), span = Math.max(...hi.map((v, i) => v - lo[i]), 0.1), scale = 260 * zoom / span;
    return p => { const x = p[0] - ctr[0], y = p[1] - ctr[1], z = (p[2] || 0) - ctr[2], rx = x * Math.cos(yaw) + z * Math.sin(yaw), rz = -x * Math.sin(yaw) + z * Math.cos(yaw); return [360 + rx * scale, 190 - (y * Math.cos(pitch) - rz * Math.sin(pitch)) * scale, y * Math.sin(pitch) + rz * Math.cos(pitch)]; };
  }, [points, lines, faces, yaw, pitch, zoom]);
  const path = list => list.map(p => project(p).slice(0, 2).join(',')).join(' ');
  return <div className="space-y-2">
    <svg viewBox="0 0 720 390" className="w-full touch-none rounded-xl bg-background/50" role="img" aria-label={label} onPointerDown={e => { drag.current = [e.clientX, e.clientY, yaw, pitch]; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerMove={e => { if (!drag.current) return; setYaw(drag.current[2] + (e.clientX - drag.current[0]) / 140); setPitch(drag.current[3] + (e.clientY - drag.current[1]) / 140); }}>
      {[...faces].sort((a, b) => project(a.points[0])[2] - project(b.points[0])[2]).map((f, i) => <polygon key={i} points={path(f.points)} fill="hsl(var(--cyan) / 0.08)" stroke="hsl(var(--cyan) / 0.3)" strokeWidth="1" />)}
      {lines.map((l, i) => <polyline key={i} points={path(l.points)} fill="none" stroke={l.id === selected ? 'hsl(var(--foreground))' : 'hsl(var(--cyan))'} strokeWidth={l.id === selected ? 3 : 1.5} strokeDasharray={l.dashed ? '5 4' : undefined} opacity="0.8" />)}
      {[...points].sort((a, b) => project(a.p)[2] - project(b.p)[2]).map((p, i) => { const [x, y] = project(p.p); return <g key={p.id ?? i} role={onSelect && p.id != null ? 'button' : undefined} tabIndex={onSelect && p.id != null ? 0 : undefined} aria-label={p.label} onClick={() => p.id != null && onSelect?.(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.id); } }}>
        <circle cx={x} cy={y} r={p.radius ?? 5} fill={p.kind === 'atom' ? 'hsl(var(--card))' : 'hsl(var(--cyan))'} stroke={selected === p.id ? 'hsl(var(--foreground))' : 'hsl(var(--cyan))'} strokeWidth={selected === p.id ? 3 : 1.4} />
        <text x={x + (p.radius ?? 5) + 4} y={y + 4} fontSize="11" fill="hsl(var(--foreground))">{p.label}</text><title>{p.label}: {p.p.map(v => v.toFixed(3)).join(', ')}</title>
      </g>; })}
    </svg>
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
      <span>Drag to rotate</span><label>Yaw <input aria-label="Scene yaw" className="w-20 align-middle accent-cyan-j" type="range" min="-3.14" max="3.14" step="0.01" value={yaw} onChange={e => setYaw(Number(e.target.value))} /></label>
      <label>Pitch <input aria-label="Scene pitch" className="w-20 align-middle accent-cyan-j" type="range" min="-1.57" max="1.57" step="0.01" value={pitch} onChange={e => setPitch(Number(e.target.value))} /></label>
      <label>Zoom <input aria-label="Scene zoom" className="w-20 align-middle accent-cyan-j" type="range" min="0.6" max="2" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
      <Button size="sm" variant="outline" onClick={() => { setYaw(0.45); setPitch(0.25); setZoom(1); }}>Reset view</Button>
    </div>
  </div>;
}