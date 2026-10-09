import React, { useRef, useState, useMemo } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const schema = [
  { key: 'ecc', label: 'Eccentricity e', min: 0, max: 0.9, step: 0.01, type: 'range' },
  { key: 'a', label: 'Semi-major axis a', min: 80, max: 200, step: 5, type: 'range' },
  { key: 'law', label: 'Law to visualize', type: 'select', options: [
    { value: 'first', label: '1st: Elliptical orbits' },
    { value: 'second', label: '2nd: Equal areas' },
    { value: 'third', label: '3rd: T² ∝ a³' },
  ] },
];

function makeInitial(p) {
  const a = p.a, e = p.ecc;
  const b = a * Math.sqrt(1 - e * e);
  // start at perihelion
  return { x: a * (1 - e), y: 0, vx: 0, vy: Math.sqrt(500 * (1 + e) / (a * (1 - e))), t: 0, swept: [], angle: 0 };
}

function step(s, dt, p) {
  const r2 = s.x * s.x + s.y * s.y + 0.01;
  const r = Math.sqrt(r2);
  const acc = -500 / r2;
  s.vx += (acc * s.x / r) * dt;
  s.vy += (acc * s.y / r) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.t += dt;
  s.angle = Math.atan2(s.y, s.x);
  if (p.law === 'second') {
    s.swept.push([s.x, s.y]);
    if (s.swept.length > 2000) s.swept.shift();
  }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const a = p.a, e = p.ecc, b = a * Math.sqrt(1 - e * e);
  // ellipse
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const ang = (i / 100) * 2 * Math.PI;
    const x = a * Math.cos(ang) - a * e, y = b * Math.sin(ang);
    if (i === 0) ctx.moveTo(cx + x, cy + y); else ctx.lineTo(cx + x, cy + y);
  }
  ctx.stroke();
  // focus (Sun)
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(cx - a * e, cy, 6, 0, Math.PI * 2); ctx.fill();
  // swept area for 2nd law
  if (p.law === 'second' && s.swept.length > 2) {
    ctx.fillStyle = '#22d3ee22';
    ctx.beginPath(); ctx.moveTo(cx - a * e, cy);
    for (const pt of s.swept) ctx.lineTo(cx + pt[0], cy + pt[1]);
    ctx.closePath(); ctx.fill();
  }
  // planet
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(cx + s.x, cy + s.y, 5, 0, Math.PI * 2); ctx.fill();
  // perihelion/aphelion markers
  ctx.fillStyle = '#84cc16'; ctx.beginPath(); ctx.arc(cx + a * (1 - e), cy, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(cx - a * (1 + e), cy, 2, 0, Math.PI * 2); ctx.fill();
}

function computeStats(s, p) {
  const r = Math.sqrt(s.x * s.x + s.y * s.y);
  const v2 = s.vx * s.vx + s.vy * s.vy;
  const T = 2 * Math.PI * Math.sqrt(Math.pow(p.a, 3) / 500);
  return { 'e': p.ecc.toFixed(2), 'a': p.a.toFixed(0), 'T': T.toFixed(1), 'r': r.toFixed(1) };
}

export default function KeplersLawsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ ecc: 0.5, a: 120, law: 'first' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.ecc}|${params.a}|${params.law}` });
  const { explain, explaining, output } = useAIExplain();

  const thirdLawData = useMemo(() => {
    const out = [];
    for (let a = 50; a <= 250; a += 5) {
      const T = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / 500);
      out.push({ a, T: +T.toFixed(2), T2: +(T * T).toFixed(2), a3: +(a * a * a).toFixed(0) });
    }
    return out;
  }, []);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Kepler's Laws of Planetary Motion" subtitle="Three laws: (1) orbits are ellipses with the Sun at a focus, (2) equal areas in equal times, (3) T² ∝ a³."
        onExplain={() => explain(`Kepler's laws: e=${params.ecc}, a=${params.a}. Law ${params.law}. The orbit is an ellipse; area sweep rate is constant; period scales as a^1.5.`)} explaining={explaining} />
      <SimLayout title="Kepler's Laws" configName="kepler" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="kepler" />}
        graph={params.law === 'third' ? <SciPlot type="line" data={thirdLawData} xKey="a3" series={[{ key: 'T2', label: 'T²', color: '#22d3ee' }]} xLabel="a³" yLabel="T²" height={180} exportName="kepler3" /> : null} />
      {params.law === 'second' && <Card title="2nd Law: Equal Areas"><p className="text-xs text-muted-foreground">The cyan shaded area is swept at a constant rate. The planet moves faster near perihelion (green) and slower near aphelion (orange).</p></Card>}
      {params.law === 'third' && <Card title="3rd Law: T² ∝ a³"><p className="text-xs text-muted-foreground">The linear T² vs a³ plot confirms Kepler's third law. The slope depends on the central mass (GM).</p></Card>}
      <AIPanel output={output} />
    </div>
  );
}