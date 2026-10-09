import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ExportBar, SimLayout, CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Reynolds number Re = ρvL/μ = inertial/viscous force ratio.
// Regimes: Re < 2300 laminar (pipe), 2300–4000 transitional, > 4000 turbulent.
const schema = [
  { key: 'rho', label: 'Density ρ (kg/m³)', min: 0.5, max: 14000, step: 0.5, type: 'range' },
  { key: 'v', label: 'Speed v (m/s)', min: 0.01, max: 100, step: 0.01, type: 'range' },
  { key: 'L', label: 'Length L (m)', min: 0.001, max: 10, step: 0.001, type: 'range' },
  { key: 'mu', label: 'Viscosity μ (mPa·s)', min: 0.01, max: 2000, step: 0.01, type: 'range' },
];

const PRESETS = [
  { name: 'Honey in pipe', rho: 1420, v: 0.1, L: 0.05, mu: 10000 },
  { name: 'Water in capillary', rho: 1000, v: 0.01, L: 0.001, mu: 1 },
  { name: 'Air over wing', rho: 1.2, v: 50, L: 1.5, mu: 0.018 },
  { name: 'Blood in artery', rho: 1060, v: 0.4, L: 0.005, mu: 3.5 },
  { name: 'Ocean current', rho: 1025, v: 0.2, L: 100, mu: 1 },
];

function ProfileCanvas({ Re }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const cy = h / 2, Rh = h * 0.35, padX = w * 0.1;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(padX, cy - Rh); ctx.lineTo(w - padX, cy - Rh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padX, cy + Rh); ctx.lineTo(w - padX, cy + Rh); ctx.stroke();
    // profile shape depends on regime
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    const turbulent = Re > 4000;
    for (let i = 0; i <= 60; i++) {
      const r = (i / 60) * 2 - 1;
      const u = turbulent ? 1 - Math.pow(Math.abs(r), 10) : 1 - r * r; // flatter for turbulent
      const px = padX + u * (w - 2 * padX) * 0.5;
      const py = cy + r * Rh;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
    ctx.fillText(turbulent ? 'Turbulent (flatter, 1/n power law)' : 'Laminar (parabolic)', 10, 16);
    ctx.fillText(`Re = ${Re.toExponential(2)}`, w - 120, 16);
  }, [Re]);
  return <CanvasStage ref={ref} />;
}

export default function ReynoldsNumberSim() {
  const [params, setParams] = useState({ rho: 1000, v: 1, L: 0.05, mu: 1 });
  const Re = useMemo(() => (params.rho * params.v * params.L) / (params.mu * 1e-3), [params]);
  const regime = Re < 2300 ? 'Laminar' : Re < 4000 ? 'Transitional' : 'Turbulent';
  const regimeColor = Re < 2300 ? '#22d3ee' : Re < 4000 ? '#f59e0b' : '#ef4444';
  const data = useMemo(() => {
    const arr = [];
    for (let r = 1; r <= 1e5; r *= 1.5) {
      let label = 'Laminar';
      if (r > 4000) label = 'Turbulent'; else if (r > 2300) label = 'Transitional';
      arr.push({ Re: r, regime: label === 'Laminar' ? 1 : label === 'Transitional' ? 2 : 3 });
    }
    return arr;
  }, []);
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Reynolds Number — Regime Predictor" subtitle="Re = ρvL/μ is the ratio of inertial to viscous forces. It predicts whether flow is laminar, transitional, or turbulent." onExplain={() => explain(`Reynolds: Re=${Re.toExponential(3)}, regime=${regime}. ρ=${params.rho}, v=${params.v}, L=${params.L}, μ=${params.mu}mPa·s`)} explaining={explaining} />
      <SimLayout title="Reynolds Number" configName="reynolds" canvasRef={{ current: null }} params={params} schema={schema} setParams={setParams}
        controls={<div className="rounded-xl border border-border/60 bg-card/40 p-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">Reynolds number</span><span className="font-mono text-lg" style={{ color: regimeColor }}>Re = {Re.toExponential(3)}</span><span className="text-sm font-bold" style={{ color: regimeColor }}>{regime}</span></div>}
        stats={<StatGridLite stats={{ 'Re': Re.toExponential(2), 'Regime': regime, 'Inertia/viscosity': Re.toExponential(2), 'Threshold (laminar)': '< 2300', 'Threshold (turbulent)': '> 4000' }} />}
        graph={<div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="Re" scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          <ReferenceLine x={2300} stroke="#22d3ee" label={{ value: 'laminar', fontSize: 9, fill: '#22d3ee' }} />
          <ReferenceLine x={4000} stroke="#ef4444" label={{ value: 'turbulent', fontSize: 9, fill: '#ef4444' }} />
          <Line type="stepAfter" dataKey="regime" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>}
        exportBar={<ExportBar graphData={data} config={params} canvasRef={{ current: null }} name="reynolds" />}
        extra={<Card title="Presets"><div className="flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.name} onClick={() => setParams({ rho: p.rho, v: p.v, L: p.L, mu: p.mu })} className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent">{p.name}</button>)}</div></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}><ProfileCanvas Re={Re} /></div>
      <AIPanel output={output} />
    </div>
  );
}

function StatGridLite({ stats }) {
  const entries = Object.entries(stats || {});
  return <div className="grid grid-cols-2 gap-2">{entries.map(([k, v]) => <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div>;
}