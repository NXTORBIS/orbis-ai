import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ExportBar, SimLayout, CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Bernoulli: P + ½ρv² + ρgh = const along a streamline.
// Venturi tube: cross-section narrows → speed up → pressure drops.
// Continuity: A1 v1 = A2 v2.
const schema = [
  { key: 'rho', label: 'Density ρ (kg/m³)', min: 500, max: 14000, step: 50, type: 'range' },
  { key: 'v1', label: 'Inlet speed v₁ (m/s)', min: 0.5, max: 30, step: 0.5, type: 'range' },
  { key: 'ratio', label: 'Area ratio A₂/A₁', min: 0.1, max: 0.9, step: 0.05, type: 'range' },
  { key: 'P1', label: 'Inlet pressure P₁ (kPa)', min: 80, max: 200, step: 1, type: 'range' },
];

function VenturiCanvas({ params }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const { v1, ratio, P1, rho } = params;
    const v2 = v1 / ratio;
    const P2 = P1 * 1000 + 0.5 * rho * (v1 * v1 - v2 * v2); // Pa
    // draw pipe profile: wide → narrow → wide
    const segs = 100;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = t < 0.5 ? 1 - (1 - ratio) * (t / 0.5) : ratio + (1 - ratio) * ((t - 0.5) / 0.5);
      const yTop = h / 2 - r * h * 0.3;
      if (i === 0) ctx.moveTo(0, yTop); else ctx.lineTo(t * w, yTop);
    }
    for (let i = segs; i >= 0; i--) {
      const t = i / segs;
      const r = t < 0.5 ? 1 - (1 - ratio) * (t / 0.5) : ratio + (1 - ratio) * ((t - 0.5) / 0.5);
      const yBot = h / 2 + r * h * 0.3;
      ctx.lineTo(t * w, yBot);
    }
    ctx.closePath(); ctx.stroke();
    // fill fluid
    ctx.fillStyle = 'rgba(34,211,238,0.1)'; ctx.fill();
    // pressure colour along pipe
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const r = t < 0.5 ? 1 - (1 - ratio) * (t / 0.5) : ratio + (1 - ratio) * ((t - 0.5) / 0.5);
      const v = v1 / r;
      const P = P1 * 1000 + 0.5 * rho * (v1 * v1 - v * v);
      const pFrac = Math.max(0, Math.min(1, (P - 50000) / 150000));
      ctx.fillStyle = `hsla(${200 - pFrac * 60}, 70%, 50%, 0.3)`;
      ctx.fillRect(t * w, h / 2 - r * h * 0.3, w / segs + 1, r * h * 0.6);
    }
    // labels
    ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
    ctx.fillText(`v₁=${v1.toFixed(1)} P₁=${(P1).toFixed(0)}kPa`, 8, 20);
    ctx.fillText(`v₂=${v2.toFixed(1)} P₂=${(P2 / 1000).toFixed(1)}kPa`, w / 2 - 60, h / 2 - ratio * h * 0.3 - 8);
  }, [params]);
  return <CanvasStage ref={ref} />;
}

export default function BernoulliSim() {
  const [params, setParams] = useState({ rho: 1000, v1: 5, ratio: 0.4, P1: 101 });
  const data = useMemo(() => {
    const { v1, ratio, P1, rho } = params;
    const arr = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const r = t < 0.5 ? 1 - (1 - ratio) * (t / 0.5) : ratio + (1 - ratio) * ((t - 0.5) / 0.5);
      const v = v1 / r;
      const P = P1 * 1000 + 0.5 * rho * (v1 * v1 - v * v);
      arr.push({ x: +t.toFixed(3), speed: +v.toFixed(2), pressure_kPa: +(P / 1000).toFixed(2) });
    }
    return arr;
  }, [params]);
  const v2 = params.v1 / params.ratio;
  const P2 = params.P1 + 0.5 * params.rho * (params.v1 ** 2 - v2 ** 2) / 1000;
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Bernoulli Equation — Venturi Effect" subtitle="Along a streamline: P + ½ρv² + ρgh = const. Continuity A₁v₁ = A₂v₂. Where the pipe narrows, speed rises and pressure drops." onExplain={() => explain(`Bernoulli: v1=${params.v1}, v2=${v2.toFixed(2)}, P1=${params.P1}kPa, P2=${P2.toFixed(1)}kPa, ratio=${params.ratio}`)} explaining={explaining} />
      <SimLayout title="Bernoulli" configName="bernoulli" canvasRef={{ current: null }} params={params} schema={schema} setParams={setParams}
        controls={<div className="rounded-xl border border-border/60 bg-card/40 p-2 text-xs text-muted-foreground">Pressure–speed trade-off along a Venturi tube.</div>}
        stats={<StatGridLite stats={{ 'v₁ (inlet)': `${params.v1.toFixed(1)} m/s`, 'v₂ (throat)': `${v2.toFixed(1)} m/s`, 'P₁': `${params.P1} kPa`, 'P₂': `${P2.toFixed(1)} kPa`, 'ΔP': `${(P2 - params.P1).toFixed(1)} kPa` }} />}
        graph={<div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'position', position: 'insideBottom', offset: -2, fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          <Line type="monotone" dataKey="speed" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="pressure_kPa" stroke="#f97316" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>}
        exportBar={<ExportBar graphData={data} config={params} canvasRef={{ current: null }} name="bernoulli" />}
        extra={<Card><p className="text-xs text-muted-foreground">Cyan = speed, orange = pressure. As area shrinks, speed rises and pressure falls — the basis of carburettors, atomisers, and lift on an airfoil.</p></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 280 }}><VenturiCanvas params={params} /></div>
      <AIPanel output={output} />
    </div>
  );
}

function StatGridLite({ stats }) {
  const entries = Object.entries(stats || {});
  return <div className="grid grid-cols-2 gap-2">{entries.map(([k, v]) => <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div>;
}