import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import Spectrogram from '../Spectrogram.jsx';

// Gravitational-wave inspiral waveform at leading post-Newtonian order.
// For a circular binary: f(t) follows the chirp and h(t) ∝ f^{2/3} cos(2Φ).
//   M_chirp = (m1 m2)^{3/5} / (m1+m2)^{1/5}   (geometrised, c=G=1 display units)
//   f(τ) = (1/π) (5/256 τ)^{-3/8} / M_chirp,  τ = t_coalesce − t
//   h(t) = A f^{2/3} cos(2π ∫ f dt)
export default function GravitationalWaves() {
  const [m1, setM1] = useState(30); const [m2, setM2] = useState(25); const [dist, setDist] = useState(400);
  const { explain, explaining, output } = useAIExplain();
  const Mc = Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);
  const data = useMemo(() => {
    const out = []; const N = 4000; const fMax = 0.05; // cutoff at merger
    let t = 0; const dt = 0.5; let phase = 0; let f = 0.005;
    for (let i = 0; i < N; i++) {
      const tau = 1000 - t; if (tau < 1) break;
      f = (1 / Math.PI) * Math.pow(5 / 256 / tau, -3 / 8) / Mc * 0.01;
      f = Math.min(f, fMax);
      const h = (1 / dist) * Math.pow(f, 2 / 3) * Math.cos(phase) * 1e3;
      out.push({ t, h, f: f * 1000 });
      phase += 2 * Math.PI * f * dt; t += dt;
    }
    return out;
  }, [m1, m2, dist, Mc]);
  const signal = data.map((d) => d.h);
  return (
    <div className="space-y-4">
      <ResearchHeader title="Gravitational-Wave Laboratory" subtitle="Leading-order binary-inspiral chirp: f(t) from the quadrupole formula and strain h(t) ∝ f^{2/3} cos(2Φ). Time-domain waveform, frequency evolution, and spectrogram. No numerical-relativity merger — leading PN only."
        onExplain={() => explain(`GW: m1=${m1}, m2=${m2}, chirp mass=${Mc.toFixed(2)}, distance=${dist}. Chirp frequency rises until merger cutoff.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Binary Parameters">
          <NumField label="m₁ (M☉)" value={m1} onChange={setM1} min={1} max={100} step={1} />
          <div className="mt-2"><NumField label="m₂ (M☉)" value={m2} onChange={setM2} min={1} max={100} step={1} /></div>
          <div className="mt-2"><NumField label="Distance (Mpc)" value={dist} onChange={setDist} min={50} max={2000} step={50} /></div>
          <SciTable headers={['Quantity', 'Value']} rows={[['Chirp mass M_c', Mc.toFixed(3) + ' M☉'], ['Total mass', (m1 + m2) + ' M☉'], ['Mass ratio q', (Math.min(m1, m2) / Math.max(m1, m2)).toFixed(3)], ['Peak f', (data[data.length - 1]?.f || 0).toFixed(2) + ' arb']]} />
        </Card>
        <div className="space-y-3">
          <Card title="Strain h(t)"><SciPlot type="line" data={data} xKey="t" series={[{ key: 'h', label: 'h(t)', color: '#22d3ee' }]} xLabel="t" yLabel="strain" height={200} exportName="gw-strain" /></Card>
          <Card title="Frequency evolution f(t)"><SciPlot type="line" data={data} xKey="t" series={[{ key: 'f', label: 'f(t)', color: '#f97316' }]} xLabel="t" yLabel="frequency" height={180} exportName="gw-freq" /></Card>
          <Card title="Spectrogram"><Spectrogram signal={signal} sampleRate={1000} window={256} hop={64} height={220} label="time → · frequency ↑" /></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}