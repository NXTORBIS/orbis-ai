import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Shock waves: supersonic source emits wavefronts that pile up into a Mach cone.
// sin(α) = c/v = 1/M.  Rankine–Hugoniot: P2/P1 = 1 + (2γ/(γ+1))(M²-1).
const schema = [
  { key: 'M', label: 'Mach number M = v/c', min: 0.5, max: 10, step: 0.05, type: 'range' },
  { key: 'gamma', label: 'Adiabatic index γ', min: 1.1, max: 1.67, step: 0.01, type: 'range' },
  { key: 'P1', label: 'Upstream P₁ (kPa)', min: 10, max: 200, step: 1, type: 'range' },
];

function makeInitial() { return { t: 0, fronts: [] }; }

function step(s, dt, p) {
  s.t += dt;
  // emit a wavefront every 0.1s
  if (Math.floor(s.t * 10) > (s.fronts.length === 0 ? -1 : s.fronts[s.fronts.length - 1].id)) {
    s.fronts.push({ id: Math.floor(s.t * 10), t0: s.t, x: 0 });
  }
  // cull old fronts
  s.fronts = s.fronts.filter((f) => s.t - f.t0 < 4);
}

function draw(ctx, s, p, w, h, t) {
  stageBg(ctx, w, h);
  const c = 1; // normalized
  const v = p.M * c;
  const sourceX = ((s.t * v * 0.15) % (w * 1.3)) - w * 0.1;
  const sourceY = h / 2;
  // wavefronts: each expands as sphere from emission point
  for (const f of s.fronts) {
    const age = s.t - f.t0;
    const emitX = f.t0 * v * 0.15 - w * 0.1;
    const radius = age * c * 60;
    if (radius < 2) continue;
    ctx.strokeStyle = `rgba(34,211,238,${Math.max(0.1, 0.5 - age * 0.15)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(emitX, sourceY, radius, 0, Math.PI * 2); ctx.stroke();
  }
  // Mach cone (only if supersonic)
  if (p.M > 1) {
    const alpha = Math.asin(1 / p.M);
    const coneLen = w;
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(sourceX - coneLen, sourceY - coneLen * Math.tan(alpha));
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(sourceX - coneLen, sourceY + coneLen * Math.tan(alpha));
    ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.font = '11px monospace';
    ctx.fillText(`α = ${(alpha * 180 / Math.PI).toFixed(1)}°`, sourceX + 8, sourceY - 8);
  }
  // source
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(sourceX, sourceY, 6, 0, Math.PI * 2); ctx.fill();
  // velocity arrow
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sourceX, sourceY); ctx.lineTo(sourceX + 30, sourceY); ctx.stroke();
}

function computeStats(s, p) {
  const M = p.M;
  const alpha = M > 1 ? Math.asin(1 / M) * 180 / Math.PI : 0;
  const P2 = p.P1 * (1 + (2 * p.gamma / (p.gamma + 1)) * (M * M - 1));
  const T2_T1 = (1 + (2 * p.gamma / (p.gamma + 1)) * (M * M - 1)) * ((2 + (p.gamma - 1) * M * M) / ((p.gamma + 1) * M * M));
  const rho2_rho1 = ((p.gamma + 1) * M * M) / ((p.gamma - 1) * M * M + 2);
  return {
    'Mach M': M.toFixed(2),
    'Regime': M < 1 ? 'Subsonic' : M < 5 ? 'Supersonic' : 'Hypersonic',
    'Mach angle α': M > 1 ? `${alpha.toFixed(1)}°` : 'N/A (subsonic)',
    'P₂/P₁': (P2 / p.P1).toFixed(2),
    'T₂/T₁': T2_T1.toFixed(2),
    'ρ₂/ρ₁': rho2_rho1.toFixed(2),
  };
}

export default function ShockWavesSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ M: 2, gamma: 1.4, P1: 101 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.M}` });
  const data = useMemo(() => {
    const arr = [];
    for (let M = 0.5; M <= 10; M += 0.1) {
      const P2_P1 = 1 + (2 * params.gamma / (params.gamma + 1)) * (M * M - 1);
      arr.push({ M: +M.toFixed(2), P2_P1: +P2_P1.toFixed(2) });
    }
    return arr;
  }, [params.gamma]);
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Shock Waves — Supersonic Fronts" subtitle="A source moving faster than sound (M = v/c > 1) piles wavefronts into a Mach cone with half-angle α where sin(α) = 1/M. Across the shock, Rankine–Hugoniot conditions give a sharp pressure, density and temperature jump." onExplain={() => explain(`Shock wave: M=${params.M}, γ=${params.gamma}. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Shock Waves" configName="shock" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="shock" />}
        extra={<Card><p className="text-xs text-muted-foreground">Orange dot = supersonic source moving right. Cyan circles = spherical wavefronts emitted at earlier times. They pile up along the red Mach cone. Subsonic (M&lt;1) sources radiate symmetrically — no shock.</p></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis dataKey="M" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Mach M', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'P₂/P₁', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine x={1} stroke="#22d3ee" label={{ value: 'M=1', fontSize: 9, fill: '#22d3ee' }} />
            <Line type="monotone" dataKey="P2_P1" stroke="#ef4444" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <AIPanel output={output} />
    </div>
  );
}