import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Sound wave propagation: longitudinal compression wave.
// Speed of sound c = sqrt(B/ρ) where B is bulk modulus.
// Particles oscillate about equilibrium; pressure/density varies sinusoidally.
const schema = [
  { key: 'freq', label: 'Frequency f (Hz)', min: 20, max: 2000, step: 10, type: 'range' },
  { key: 'amp', label: 'Amplitude', min: 0.02, max: 0.3, step: 0.01, type: 'range' },
  { key: 'B', label: 'Bulk modulus B (GPa)', min: 0.0001, max: 100, step: 0.0001, type: 'range' },
  { key: 'rho', label: 'Density ρ (kg/m³)', min: 0.5, max: 14000, step: 0.5, type: 'range' },
];

const MEDIA = [
  { name: 'Air', B: 0.000142, rho: 1.2 }, { name: 'Water', B: 2.2, rho: 1000 }, { name: 'Steel', B: 160, rho: 7800 }, { name: 'Helium', B: 0.00017, rho: 0.179 }, { name: 'Mercury', B: 25, rho: 13546 },
];

function makeInitial() { return { particles: Array.from({ length: 80 }, (_, i) => ({ eq: i / 80 })) }; }

function step(s, dt, p) {
  // wave moves particles; we just track time for phase
}

function draw(ctx, s, p, w, h, t) {
  stageBg(ctx, w, h);
  const c = Math.sqrt((p.B * 1e9) / p.rho);
  const lambda = c / p.freq;
  const k = (2 * Math.PI) / lambda * 0.02; // scaled for display
  const omega = 2 * Math.PI * p.freq * 0.01;
  const cy = h / 2;
  // particles
  for (let i = 0; i < 80; i++) {
    const xEq = (i / 80) * w;
    const displacement = p.amp * w * Math.sin(k * xEq * 0.1 - omega * t);
    const x = xEq + displacement;
    // density: closer to neighbours = higher pressure
    const density = 0.5 + 0.5 * Math.cos(k * xEq * 0.1 - omega * t);
    const radius = 3 + density * 4;
    ctx.fillStyle = `hsl(${200 - density * 60}, 70%, ${50 + density * 20}%)`;
    ctx.beginPath(); ctx.arc(x, cy, radius, 0, Math.PI * 2); ctx.fill();
  }
  // pressure wave overlay
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const pres = Math.cos(k * x * 0.1 - omega * t);
    const y = cy - h * 0.3 + pres * h * 0.12;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
  ctx.fillText(`c = ${c.toFixed(1)} m/s`, 10, 18);
  ctx.fillText(`λ = ${(lambda * 100).toFixed(2)} cm`, 10, 34);
  ctx.fillText(`Orange = pressure wave`, 10, h - 6);
}

function computeStats(s, p) {
  const c = Math.sqrt((p.B * 1e9) / p.rho);
  const lambda = c / p.freq;
  return {
    'Speed of sound c': `${c.toFixed(1)} m/s`,
    'Wavelength λ': `${(lambda * 100).toFixed(2)} cm`,
    'Frequency f': `${p.freq} Hz`,
    'Period T': `${(1000 / p.freq).toFixed(2)} ms`,
    'Wave type': 'longitudinal',
    'Medium': `${p.B < 0.001 ? 'gas' : p.B < 5 ? 'liquid' : 'solid'}`,
  };
}

export default function WavePropagationSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ freq: 440, amp: 0.1, B: 0.000142, rho: 1.2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.freq}-${params.B}-${params.rho}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Wave Propagation — Sound in Fluids" subtitle="Sound is a longitudinal pressure wave. Speed c = sqrt(B/ρ) depends on the medium's bulk modulus and density. Particles oscillate about equilibrium; compressions (high pressure) travel at c." onExplain={() => explain(`Sound wave: f=${params.freq}Hz, c=${Math.sqrt(params.B*1e9/params.rho).toFixed(1)}m/s. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Wave Propagation" configName="wave-prop" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="wave-prop" />}
        extra={<Card title="Medium presets"><div className="flex flex-wrap gap-1.5">{MEDIA.map((m) => <button key={m.name} onClick={() => setParams({ ...params, B: m.B, rho: m.rho })} className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent">{m.name} ({Math.sqrt(m.B*1e9/m.rho).toFixed(0)} m/s)</button>)}</div></Card>} />
      <AIPanel output={output} />
    </div>
  );
}