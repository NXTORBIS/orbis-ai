import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ExportBar, SimLayout } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card, SciTable } from '../research.jsx';
import { CanvasStage } from '../ui.jsx';

// Static (hydrostatic) and dynamic pressure.
// P_static = ρ g h  (depth),  P_dynamic = ½ ρ v²  (stagnation).
const schema = [
  { key: 'rho', label: 'Fluid density ρ (kg/m³)', min: 500, max: 14000, step: 50, type: 'range' },
  { key: 'depth', label: 'Depth h (m)', min: 1, max: 100, step: 1, type: 'range' },
  { key: 'velocity', label: 'Flow speed v (m/s)', min: 0, max: 50, step: 0.5, type: 'range' },
  { key: 'g', label: 'Gravity g (m/s²)', min: 1.6, max: 24.8, step: 0.1, type: 'range' },
];

const FLUIDS = [
  { name: 'Water', rho: 1000 }, { name: 'Mercury', rho: 13546 }, { name: 'Oil', rho: 850 }, { name: 'Seawater', rho: 1025 }, { name: 'Glycerin', rho: 1260 },
];

function PressureColumn({ params }) {
  const ref = useRef(null);
  const { rho, depth, g } = params;
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, w, h);
    const colW = w * 0.4, colX = w * 0.3, top = h * 0.08, bot = h * 0.92;
    const colH = bot - top;
    // fluid gradient
    const grad = ctx.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, 'rgba(34,211,238,0.5)');
    grad.addColorStop(1, 'rgba(34,80,160,0.8)');
    ctx.fillStyle = grad; ctx.fillRect(colX, top, colW, colH);
    // pressure bars at depths
    for (let i = 0; i <= 10; i++) {
      const d = (i / 10) * depth;
      const y = top + (i / 10) * colH;
      const P = rho * g * d;
      const barLen = (P / (rho * g * depth)) * (w * 0.25);
      ctx.fillStyle = `hsl(${200 - i * 15}, 70%, 55%)`;
      ctx.fillRect(colX + colW + 4, y - 3, barLen, 6);
      ctx.fillStyle = '#a0a0a0'; ctx.font = '11px monospace';
      ctx.fillText(`${P.toFixed(0)} Pa`, colX + colW + 4 + barLen + 4, y + 3);
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(colX, top, colW, colH);
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
    ctx.fillText(`h = ${depth} m`, colX + colW / 2 - 25, top - 6);
  }, [params]);
  return <CanvasStage ref={ref} />;
}

export default function FluidPressureSim() {
  const [params, setParams] = useState({ rho: 1000, depth: 20, velocity: 10, g: 9.81 });
  const data = useMemo(() => {
    const arr = [];
    for (let d = 0; d <= params.depth; d += params.depth / 30) {
      arr.push({ h: +d.toFixed(2), P_static: +(params.rho * params.g * d).toFixed(1) });
    }
    return arr;
  }, [params]);
  const P_static_bottom = params.rho * params.g * params.depth;
  const P_dynamic = 0.5 * params.rho * params.velocity * params.velocity;
  const P_stagnation = P_static_bottom + P_dynamic;
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Fluid Pressure — Static & Dynamic" subtitle="Hydrostatic pressure P = ρgh grows linearly with depth. Dynamic (stagnation) pressure q = ½ρv² comes from fluid motion." onExplain={() => explain(`Fluid pressure: ρ=${params.rho}, h=${params.depth}, v=${params.velocity}, g=${params.g}. P_static_bottom=${P_static_bottom} Pa, P_dynamic=${P_dynamic} Pa, P_stagnation=${P_stagnation} Pa`)} explaining={explaining} />
      <SimLayout title="Fluid Pressure" configName="fluid-pressure" canvasRef={{ current: null }} params={params} schema={schema} setParams={setParams}
        controls={<div className="rounded-xl border border-border/60 bg-card/40 p-2 text-xs text-muted-foreground">Static pressure rises linearly with depth; dynamic pressure scales with v².</div>}
        stats={<StatGridLite stats={{ 'P_static (bottom)': `${P_static_bottom.toFixed(0)} Pa`, 'P_dynamic': `${P_dynamic.toFixed(0)} Pa`, 'P_stagnation': `${P_stagnation.toFixed(0)} Pa`, 'ρgh + ½ρv²': 'total head' }} />}
        graph={<div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="h" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'depth (m)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'P (Pa)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          <Line type="monotone" dataKey="P_static" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>}
        exportBar={<ExportBar graphData={data} config={params} canvasRef={{ current: null }} name="fluid-pressure" />}
        extra={<Card title="Fluid presets"><div className="flex flex-wrap gap-1.5">{FLUIDS.map((f) => <button key={f.name} onClick={() => setParams({ ...params, rho: f.rho })} className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent">{f.name} ({f.rho})</button>)}</div></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 360 }}><PressureColumn params={params} /></div>
      <AIPanel output={output} />
    </div>
  );
}

function StatGridLite({ stats }) {
  const entries = Object.entries(stats || {});
  return <div className="grid grid-cols-2 gap-2">{entries.map(([k, v]) => <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div>;
}