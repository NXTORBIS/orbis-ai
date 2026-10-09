import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ExportBar, SimLayout, CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Poiseuille pipe flow: Q = π R⁴ ΔP / (8 μ L).  The R⁴ law.
// Parabolic profile, pressure drop linear along pipe.
const schema = [
  { key: 'R', label: 'Radius R (mm)', min: 0.5, max: 20, step: 0.1, type: 'range' },
  { key: 'dP', label: 'Pressure drop ΔP (kPa)', min: 0.1, max: 500, step: 0.1, type: 'range' },
  { key: 'mu', label: 'Viscosity μ (mPa·s)', min: 0.5, max: 2000, step: 0.5, type: 'range' },
  { key: 'L', label: 'Pipe length L (m)', min: 0.01, max: 10, step: 0.01, type: 'range' },
];

function ProfileCanvas({ params, uMax }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const cy = h / 2, Rh = Math.min(h * 0.35, params.R * 8), padX = w * 0.08;
    // pipe
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(padX, cy - Rh); ctx.lineTo(w - padX, cy - Rh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padX, cy + Rh); ctx.lineTo(w - padX, cy + Rh); ctx.stroke();
    // pressure gradient colour
    const grad = ctx.createLinearGradient(padX, 0, w - padX, 0);
    grad.addColorStop(0, 'rgba(239,68,68,0.25)');
    grad.addColorStop(1, 'rgba(34,211,238,0.25)');
    ctx.fillStyle = grad; ctx.fillRect(padX, cy - Rh, w - 2 * padX, 2 * Rh);
    // parabolic profile
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const r = (i / 60) * 2 - 1;
      const u = uMax * (1 - r * r);
      const px = padX + (u / 2) * (w - 2 * padX) * 0.4;
      const py = cy + r * Rh;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
    ctx.fillText(`ΔP high →`, padX, cy - Rh - 6);
    ctx.fillText(`→ ΔP low`, w - padX - 60, cy - Rh - 6);
  }, [params, uMax]);
  return <CanvasStage ref={ref} />;
}

export default function PipeFlowSim() {
  const [params, setParams] = useState({ R: 3, dP: 100, mu: 1, L: 1 });
  const { R, dP, mu, L } = params;
  const R_m = R * 1e-3, dP_Pa = dP * 1000, mu_Pa = mu * 1e-3;
  const uMax = (R_m * R_m * dP_Pa) / (4 * mu_Pa * L);
  const uAvg = uMax / 2;
  const Q = (Math.PI * R_m ** 4 * dP_Pa) / (8 * mu_Pa * L);
  const Re = (1000 * uAvg * 2 * R_m) / mu_Pa;
  const rLaw = useMemo(() => {
    const arr = [];
    for (let r = 0.5; r <= 20; r += 0.5) {
      const rm = r * 1e-3;
      arr.push({ R: r, Q: +(((Math.PI * rm ** 4 * dP_Pa) / (8 * mu_Pa * L)) * 1e6).toFixed(2) });
    }
    return arr;
  }, [dP, mu, L]);
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Pipe Flow — Poiseuille & the R⁴ Law" subtitle="Q = πR⁴ΔP / (8μL). Flow rate scales with the fourth power of radius — doubling R gives 16× the flow. Pressure drops linearly along the pipe." onExplain={() => explain(`Pipe flow: R=${R}mm, ΔP=${dP}kPa, μ=${mu}mPa·s, L=${L}m. u_max=${uMax.toFixed(3)}m/s, Q=${(Q * 1e6).toFixed(2)}mL/s, Re=${Re.toFixed(1)}`)} explaining={explaining} />
      <SimLayout title="Pipe Flow" configName="pipe-flow" canvasRef={{ current: null }} params={params} schema={schema} setParams={setParams}
        controls={<div className="rounded-xl border border-border/60 bg-card/40 p-2 text-xs text-muted-foreground">Parabolic profile; pressure drops linearly from inlet to outlet.</div>}
        stats={<StatGridLite stats={{ 'u_max': `${uMax.toFixed(3)} m/s`, 'u_avg': `${uAvg.toFixed(3)} m/s`, 'Q': `${(Q * 1e6).toFixed(2)} mL/s`, 'Re (water)': Re.toFixed(1), 'R⁴ factor': (R ** 4 / 0.5 ** 4).toFixed(0) + '× vs R=0.5mm' }} />}
        graph={<div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={rLaw} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="R" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'R (mm)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Q (mL/s)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          <Line type="monotone" dataKey="Q" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>}
        exportBar={<ExportBar graphData={rLaw} config={params} canvasRef={{ current: null }} name="pipe-flow" />}
        extra={<Card><p className="text-xs text-muted-foreground">The R⁴ law: small radius changes cause huge flow changes. This is why blood vessels constrict/dilate to regulate flow, and why a partially clogged pipe loses enormous throughput.</p></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}><ProfileCanvas params={params} uMax={uMax} /></div>
      <AIPanel output={output} />
    </div>
  );
}

function StatGridLite({ stats }) {
  const entries = Object.entries(stats || {});
  return <div className="grid grid-cols-2 gap-2">{entries.map(([k, v]) => <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div>;
}