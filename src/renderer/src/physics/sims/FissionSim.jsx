import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Unique fission engine: neutron-induced chain reaction with multiplication
// factor k_eff. Each fission event releases 2-3 neutrons that can trigger
// further fissions. Visualizes criticality (subcritical / critical / supercritical).

const uMeV = 931.494;
const MASS = { U235: 235.043930, n: 1.008665, Ba141: 140.914411, Kr92: 91.926156 };
const Q_FISSION = (MASS.U235 + MASS.n - MASS.Ba141 - MASS.Kr92 - 3 * MASS.n) * uMeV;

const schema = [
  { key: 'k', label: 'k_eff (multiplication)', min: 0.3, max: 2.5, step: 0.05, type: 'range' },
  { key: 'neutronsPerFission', label: 'Neutrons per fission ν', min: 1, max: 4, step: 1, type: 'range' },
  { key: 'N0', label: 'Initial fissile atoms', min: 50, max: 300, step: 10, type: 'range' },
];

function makeInitial(p) {
  const atoms = [];
  for (let i = 0; i < p.N0; i++) {
    atoms.push({ x: 50 + Math.random() * 280, y: 30 + Math.random() * 340, fissioned: false });
  }
  return { atoms, neutrons: [{ x: 20, y: 200, vx: 120, vy: (Math.random() - 0.5) * 40, gen: 0 }], fissions: 0, totalE: 0, gen: 0 };
}
function step(s, dt, p) {
  // Move neutrons
  for (const n of s.neutrons) {
    n.x += n.vx * dt; n.y += n.vy * dt;
    // Bounce off walls
    if (n.x < 10 || n.x > 380) { n.vx *= -1; n.x = Math.max(10, Math.min(380, n.x)); }
    if (n.y < 10 || n.y > 380) { n.vy *= -1; n.y = Math.max(10, Math.min(380, n.y)); }
    // Check collision with unfissioned atoms
    for (const a of s.atoms) {
      if (a.fissioned) continue;
      const dx = a.x - n.x, dy = a.y - n.y;
      if (dx * dx + dy * dy < 36) {
        a.fissioned = true;
        s.fissions++;
        s.totalE += Q_FISSION;
        // Emit ν new neutrons
        for (let k = 0; k < p.neutronsPerFission; k++) {
          if (Math.random() < p.k / p.neutronsPerFission) {
            const ang = Math.random() * Math.PI * 2;
            s.neutrons.push({ x: a.x, y: a.y, vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150, gen: n.gen + 1 });
          }
        }
        n.dead = true;
        if (n.gen > s.gen) s.gen = n.gen;
        break;
      }
    }
  }
  s.neutrons = s.neutrons.filter((n) => !n.dead && s.neutrons.length < 500);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // Atoms
  for (const a of s.atoms) {
    if (a.fissioned) {
      ctx.fillStyle = '#47556960';
      ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI * 2); ctx.fill();
      // fission fragments
      ctx.strokeStyle = '#f9731660'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x - 8, a.y); ctx.lineTo(a.x - 14, a.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x + 8, a.y); ctx.lineTo(a.x + 14, a.y); ctx.stroke();
    } else {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22d3ee40'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Neutrons
  for (const n of s.neutrons) {
    ctx.fillStyle = '#fde047';
    ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, Math.PI * 2); ctx.fill();
  }
}
function sample(s, p, t) {
  const remaining = s.atoms.filter((a) => !a.fissioned).length;
  return { fissions: s.fissions, neutrons: s.neutrons.length, remaining, energy: s.totalE };
}
function computeStats(s, p) {
  const regime = p.k < 1 ? 'Subcritical' : p.k === 1 ? 'Critical' : 'Supercritical';
  return { 'k_eff': p.k.toFixed(2), 'Regime': regime, 'Fissions': s.fissions, 'Neutrons': s.neutrons.length, 'E released (MeV)': s.totalE.toFixed(0), 'Generation': s.gen };
}

export default function FissionSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ k: 1.1, neutronsPerFission: 3, N0: 120 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.k}|${params.neutronsPerFission}|${params.N0}` });
  return (
    <SimLayout title="Nuclear Fission Chain Reaction" configName="fission-chain" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'fissions', color: '#ef4444' }, { key: 'neutrons', color: '#fde047' }, { key: 'remaining', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="fission-chain" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">²³⁵U + n → ¹⁴¹Ba + ⁹²Kr + 3n, Q≈200 MeV. k_eff&lt;1: dies out (subcritical). k_eff=1: steady (critical, reactor). k_eff&gt;1: exponential growth (supercritical, weapon). Yellow dots = neutrons, cyan = U-235, grey = fissioned.</div>} />
  );
}