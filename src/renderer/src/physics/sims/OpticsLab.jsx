import { useMemo, useState } from 'react';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

const MODES = [
  { value: 'snell', label: 'Refraction (Snell)' },
  { value: 'lens', label: 'Thin Lens' },
  { value: 'mirror', label: 'Spherical Mirror' },
  { value: 'prism', label: 'Prism Deviation' },
  { value: 'malus', label: 'Polarization (Malus)' },
];

export default function OpticsLab() {
  const [mode, setMode] = useState('snell');
  const [p, setP] = useState({ n1: 1.0, n2: 1.5, angle: 30, f: 10, u: 15, A: 60, nprism: 1.52, pol: 30 });

  const res = useMemo(() => {
    const r = (d) => Math.PI * d / 180;
    const d = (x) => x / Math.PI * 180;
    if (mode === 'snell') {
      const s2 = (p.n1 / p.n2) * Math.sin(r(p.angle));
      const tir = Math.abs(s2) > 1;
      const a2 = tir ? null : d(Math.asin(s2));
      const crit = p.n1 > p.n2 ? d(Math.asin(p.n2 / p.n1)) : null;
      return { tir, a2, crit, rows: [['Incidence θ₁', p.angle.toFixed(1) + '°'], ['Refraction θ₂', tir ? 'Total internal reflection' : a2.toFixed(2) + '°'], ...(crit ? [['Critical angle', crit.toFixed(2) + '°']] : [])] };
    }
    if (mode === 'lens') {
      // Cartesian sign convention: 1/v - 1/u = 1/f, u negative for real object
      const u = -Math.abs(p.u);
      const v = 1 / (1 / p.f + 1 / u);
      const m = -v / u;
      const real = v > 0;
      return { v, m, real, rows: [['Object dist u', p.u + ' cm'], ['Focal f', p.f + ' cm'], ['Image dist v', v.toFixed(2) + ' cm'], ['Magnification', m.toFixed(3)], ['Image type', real ? 'Real (inverted)' : 'Virtual (upright)']] };
    }
    if (mode === 'mirror') {
      const u = -Math.abs(p.u);
      const v = 1 / (1 / p.f - 1 / u); // mirror: 1/v + 1/u = 1/f
      const m = v / u;
      return { v, m, rows: [['Object dist u', p.u + ' cm'], ['Focal f', p.f + ' cm'], ['Image dist v', v.toFixed(2) + ' cm'], ['Magnification', m.toFixed(3)]] };
    }
    if (mode === 'prism') {
      // Minimum deviation: sin((A+δ)/2) = n sin(A/2)
      const half = r(p.A) / 2;
      const deltaMin = 2 * d(Math.asin(p.nprism * Math.sin(half))) - p.A;
      // general deviation at incidence θ1 (equal entry/exit for min-dev approx)
      const theta1 = r(p.angle);
      const sinT2 = Math.sin(theta1) / p.nprism;
      const t2 = Math.asin(Math.min(1, sinT2));
      const t3 = p.A - t2;
      const sinT4 = p.nprism * Math.sin(t3);
      const tir = Math.abs(sinT4) > 1;
      const t4 = tir ? null : Math.asin(sinT4);
      const delta = tir ? null : d(t4) + p.angle - p.A;
      return { deltaMin, delta, tir, rows: [['Prism angle A', p.A + '°'], ['Index n', p.nprism], ['Incidence θ₁', p.angle + '°'], ...(tir ? [['Status', 'TIR at exit face']] : [['Deviation δ', delta.toFixed(2) + '°']]), ['Min deviation δₘ', deltaMin.toFixed(2) + '°']] };
    }
    // malus
    const I = Math.cos(r(p.pol)) ** 2;
    return { I, rows: [['Polariser angle', p.pol + '°'], ['Transmitted I/I₀', I.toFixed(4)]] };
  }, [mode, p]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((o) => (
          <button key={o.value} onClick={() => setMode(o.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${mode === o.value ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{o.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              {mode === 'snell' && <>
                <NumField label="n₁" value={p.n1} onChange={(v) => setP({ ...p, n1: v })} min={1} max={2.5} step={0.01} />
                <NumField label="n₂" value={p.n2} onChange={(v) => setP({ ...p, n2: v })} min={1} max={2.5} step={0.01} />
                <NumField label="Incidence θ₁" value={p.angle} onChange={(v) => setP({ ...p, angle: v })} min={0} max={89} step={0.5} unit="°" />
              </>}
              {(mode === 'lens' || mode === 'mirror') && <>
                <NumField label="Focal length f" value={p.f} onChange={(v) => setP({ ...p, f: v })} min={-30} max={30} step={0.5} unit="cm" />
                <NumField label="Object dist u" value={p.u} onChange={(v) => setP({ ...p, u: v })} min={1} max={60} step={0.5} unit="cm" />
              </>}
              {mode === 'prism' && <>
                <NumField label="Prism angle A" value={p.A} onChange={(v) => setP({ ...p, A: v })} min={10} max={90} step={1} unit="°" />
                <NumField label="Refractive n" value={p.nprism} onChange={(v) => setP({ ...p, nprism: v })} min={1} max={2} step={0.01} />
                <NumField label="Incidence θ₁" value={p.angle} onChange={(v) => setP({ ...p, angle: v })} min={0} max={89} step={0.5} unit="°" />
              </>}
              {mode === 'malus' && <NumField label="Polariser angle" value={p.pol} onChange={(v) => setP({ ...p, pol: v })} min={0} max={90} step={1} unit="°" />}
            </div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={res.rows} />
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mode, params: p, result: res.rows }, null, 2), 'optics.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div>
          <OpticsDiagram mode={mode} p={p} res={res} />
        </div>
      </div>
    </div>
  );
}

function OpticsDiagram({ mode, p, res }) {
  // SVG ray diagrams, deterministic from the computed geometry.
  const W = 460, H = 280, cx = W / 2, cy = H / 2;
  const r = (d) => Math.PI * d / 180;
  if (mode === 'snell') {
    const a1 = r(p.angle);
    const s2 = (p.n1 / p.n2) * Math.sin(a1);
    const a2 = res.tir ? -a1 : Math.asin(s2);
    const L = 110;
    const x1 = cx - Math.sin(a1) * L, y1 = cy - Math.cos(a1) * L;
    const x2 = cx + (res.tir ? Math.sin(a1) : Math.sin(a2)) * L, y2 = cy + (res.tir ? -Math.cos(a1) : Math.cos(a2)) * L;
    return (
      <svg width={W} height={H} className="rounded-xl border border-border/60 bg-card/40">
        <rect x={0} y={cy} width={W} height={H - cy} fill="hsl(210 80% 50% / 0.12)" />
        <line x1={0} y1={cy} x2={W} y2={cy} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
        <line x1={cx} y1={0} x2={cx} y2={H} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <line x1={x1} y1={y1} x2={cx} y2={cy} stroke="#22d3ee" strokeWidth={2} />
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={res.tir ? '#ef4444' : '#f97316'} strokeWidth={2} />
        <text x={8} y={16} fontSize={10} fill="hsl(var(--muted-foreground))">n₁ = {p.n1}</text>
        <text x={8} y={H - 8} fontSize={10} fill="hsl(var(--muted-foreground))">n₂ = {p.n2}</text>
      </svg>
    );
  }
  if (mode === 'lens' || mode === 'mirror') {
    const f = p.f, u = p.u, v = res.v || 1;
    const scale = 100 / Math.max(Math.abs(u), Math.abs(v), Math.abs(f), 1);
    const lensX = cx, objX = cx - u * scale, imgX = cx + v * scale;
    const objY = cy + 30, imgY = cy - 30 * Math.abs(res.m || 1);
    return (
      <svg width={W} height={H} className="rounded-xl border border-border/60 bg-card/40">
        <line x1={0} y1={cy} x2={W} y2={cy} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <line x1={lensX - f * scale} y1={cy - 40} x2={lensX - f * scale} y2={cy + 40} stroke="#94a3b8" strokeDasharray="2 2" />
        <line x1={lensX + f * scale} y1={cy - 40} x2={lensX + f * scale} y2={cy + 40} stroke="#94a3b8" strokeDasharray="2 2" />
        {mode === 'lens' ? <line x1={lensX} y1={cy - 50} x2={lensX} y2={cy + 50} stroke="#22d3ee" strokeWidth={2} /> : <path d={`M ${lensX - 30} ${cy - 50} Q ${lensX} ${cy} ${lensX - 30} ${cy + 50}`} fill="none" stroke="#22d3ee" strokeWidth={2} />}
        <line x1={objX} y1={cy} x2={objX} y2={objY} stroke="#f97316" strokeWidth={2} />
        <line x1={imgX} y1={cy} x2={imgX} y2={imgY} stroke="#22d3ee" strokeWidth={2} />
        <line x1={objX} y1={objY} x2={imgX} y2={imgY} stroke="#f9731666" strokeWidth={1} />
        <text x={objX - 14} y={objY + 14} fontSize={10} fill="#f97316">obj</text>
        <text x={imgX - 8} y={imgY - 6} fontSize={10} fill="#22d3ee">img</text>
      </svg>
    );
  }
  // prism / malus: simple schematic
  return (
    <svg width={W} height={H} className="rounded-xl border border-border/60 bg-card/40">
      <text x={W / 2} y={H / 2} fontSize={12} fill="hsl(var(--muted-foreground))" textAnchor="middle">{mode === 'prism' ? `Deviation δₘ = ${res.deltaMin?.toFixed(1)}°` : `Transmitted I/I₀ = ${(res.I ?? 0).toFixed(3)}`}</text>
    </svg>
  );
}