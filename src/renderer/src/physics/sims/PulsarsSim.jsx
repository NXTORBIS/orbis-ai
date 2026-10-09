import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Pulsar spin-down: Ω̇ = -K Ω^n (n=3 for magnetic dipole)
// L_spin = -I Ω Ω̇, B = 3.2e19 √(P Ṗ) G, τ = P / (2 Ṗ)
export default function PulsarsSim() {
  const [P, setP] = useState(0.033); // period in seconds (Crab-like)
  const [Pdot, setPdot] = useState(4.2e-13);
  const [tmax, setTmax] = useState(1e5); // years
  const { explain, explaining, output } = useAIExplain();

  const I = 1e38; // moment of inertia (cgs)
  const n = 3; // braking index

  const spinDown = useMemo(() => {
    const out = [];
    let Omega = 2 * Math.PI / P;
    const OmegaDot0 = -Pdot / (P * P) * 2 * Math.PI;
    const dt = tmax / 300;
    for (let i = 0; i <= 300; i++) {
      const t = i * dt;
      const period = 2 * Math.PI / Omega;
      const L = 0.5 * I * Omega * Math.abs(OmegaDot0) * Math.pow(Omega / (2 * Math.PI / P), n - 1);
      if (i % 3 === 0) out.push({ t: +t.toExponential(2), P: +period.toFixed(5), L: +L.toExponential(2) });
      const OmegaDot = OmegaDot0 * Math.pow(Omega / (2 * Math.PI / P), n - 1);
      Omega += OmegaDot * dt;
      if (Omega <= 0) break;
    }
    return out;
  }, [P, Pdot, tmax]);

  const tau = P / (2 * Pdot); // characteristic age
  const B = 3.2e19 * Math.sqrt(P * Pdot); // surface magnetic field
  const Edot = 4 * Math.PI * Math.PI * I * Pdot / Math.pow(P, 3); // spin-down luminosity

  const beamData = useMemo(() => {
    const out = [];
    for (let i = 0; i < 100; i++) {
      const phase = (i / 100) * 2 * Math.PI;
      const beam = Math.exp(-Math.pow((Math.sin(phase) - 0.3) / 0.15, 2)) + 0.3 * Math.exp(-Math.pow((Math.sin(phase + Math.PI) - 0.3) / 0.15, 2));
      out.push({ phase: +(phase * 180 / Math.PI).toFixed(0), intensity: +beam.toFixed(3) });
    }
    return out;
  }, []);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Pulsars — Rotating Beams & Spin-down" subtitle="A pulsar is a rapidly rotating, highly magnetised neutron star. Its spin-down luminosity powers the beam; Ṗ gives the age and B-field."
        onExplain={() => explain(`Pulsar: P=${P}s, Ṗ=${Pdot.toExponential(2)}. Characteristic age τ=${tau.toExponential(2)} yr, B=${B.toExponential(2)} G, Ė=${Edot.toExponential(2)} erg/s. Spin-down luminosity decreases as the pulsar ages.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Pulsar Parameters">
            <NumField label="Period P" value={P} onChange={setP} min={0.001} max={1} step={0.001} unit="s" />
            <div className="mt-2"><NumField label="Ṗ (P-dot)" value={Pdot} onChange={setPdot} min={1e-18} max={1e-12} step={1e-15} unit="s/s" /></div>
            <div className="mt-2"><NumField label="t max" value={tmax} onChange={setTmax} min={1e3} max={1e7} step={1e4} unit="yr" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Char. age τ', tau.toExponential(2) + ' yr'],
            ['B surface', B.toExponential(2) + ' G'],
            ['Ė (spin-down)', Edot.toExponential(2) + ' erg/s'],
            ['Braking n', n],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={spinDown} xKey="t" series={[{ key: 'P', label: 'P(t)', color: '#22d3ee' }]} xLabel="t (yr)" yLabel="Period P (s)" height={200} exportName="pulsar-P" />
          <SciPlot type="line" data={spinDown} xKey="t" series={[{ key: 'L', label: 'L(t)', color: '#f97316' }]} xLabel="t (yr)" yLabel="L (erg/s)" height={180} exportName="pulsar-L" />
          <SciPlot type="area" data={beamData} xKey="phase" series={[{ key: 'intensity', label: 'Beam', color: '#fde047' }]} xLabel="phase (°)" yLabel="intensity" height={160} exportName="pulsar-beam" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
        The pulsar beam (bottom plot) sweeps past the observer once per rotation, like a lighthouse. Spin-down luminosity Ė = 4π²IṖ/P³ powers the beam. As P increases, Ė drops. The Crab pulsar (P=33ms, Ṗ=4.2×10⁻¹³) has τ≈1,300 yr.
      </p>
      <AIPanel output={output} />
    </div>
  );
}