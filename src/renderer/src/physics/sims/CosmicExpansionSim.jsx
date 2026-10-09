import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Hubble expansion: v = H0 * d, z ~ v/c
// Scale factor a(t) for matter-dominated universe: a ~ t^(2/3)
export default function CosmicExpansionSim() {
  const [H0, setH0] = useState(70);
  const [dmax, setDmax] = useState(1000);
  const [OmegaM, setOmegaM] = useState(0.3);
  const { explain, explaining, output } = useAIExplain();

  const hubble = useMemo(() => {
    const c = 3e5; // km/s
    const out = [];
    for (let d = 0; d <= dmax; d += dmax / 80) {
      const v = H0 * d;
      const z = v / c;
      out.push({ d: +d.toFixed(1), v: +v.toFixed(1), z: +z.toFixed(5) });
    }
    return out;
  }, [H0, dmax]);

  const scaleFactor = useMemo(() => {
    const out = [];
    const tH = 1 / H0 * 9.78; // Hubble time in Gyr
    for (let t = 0.01; t <= 2 * tH; t += tH / 100) {
      // Matter-dominated: a = (t / tH * (3/2))^(2/3)
      const a = Math.pow(1.5 * t / tH, 2 / 3) * Math.pow(OmegaM, 1 / 3);
      // Include dark energy (simplified): a grows exponentially at late times
      const aLambda = a * (1 + (1 - OmegaM) * Math.pow(t / tH, 2) * 0.1);
      out.push({ t: +t.toFixed(2), a: +aLambda.toFixed(3) });
    }
    return out;
  }, [H0, OmegaM]);

  const age = 1 / H0 * 9.78; // Gyr (approx)

  return (
    <div className="space-y-4">
      <ResearchHeader title="Cosmic Expansion — Hubble Flow" subtitle="Galaxies recede with velocity v = H₀d. The Hubble time ~1/H₀ approximates the age of the universe. Dark energy accelerates the expansion."
        onExplain={() => explain(`Hubble expansion: H0=${H0} km/s/Mpc, dmax=${dmax} Mpc. Hubble time = ${age.toFixed(1)} Gyr. At d=${dmax} Mpc, v=${(H0 * dmax).toFixed(0)} km/s, z=${(H0 * dmax / 3e5).toFixed(3)}. Scale factor a(t) grows as t^(2/3) for matter-dominated; dark energy causes acceleration.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Cosmological Parameters">
            <NumField label="H0" value={H0} onChange={setH0} min={40} max={100} step={1} unit="km/s/Mpc" />
            <div className="mt-2"><NumField label="d max" value={dmax} onChange={setDmax} min={100} max={3000} step={50} unit="Mpc" /></div>
            <div className="mt-2"><NumField label="Omega_M" value={OmegaM} onChange={setOmegaM} min={0.1} max={1} step={0.05} /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Hubble time', age.toFixed(1) + ' Gyr'],
            ['H0', H0 + ' km/s/Mpc'],
            ['Omega_M', OmegaM.toFixed(2)],
            ['Omega_Lambda', (1 - OmegaM).toFixed(2)],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={hubble} xKey="d" series={[{ key: 'v', label: 'v(d)', color: '#22d3ee' }, { key: 'z', label: 'z(d)', color: '#f97316' }]} xLabel="d (Mpc)" yLabel="v (km/s) / z" height={240} exportName="hubble-flow" />
          <SciPlot type="line" data={scaleFactor} xKey="t" series={[{ key: 'a', label: 'a(t)', color: '#a855f7' }]} xLabel="t (Gyr)" yLabel="scale factor a(t)" height={220} exportName="scale-factor" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
        Hubble's law v = H₀d: more distant galaxies recede faster. The slope is H₀. Redshift z ~ v/c for nearby galaxies. The scale factor a(t) describes the expansion of space itself — a(t) ~ t^(2/3) for matter, exponential for dark energy domination.
      </p>
      <AIPanel output={output} />
    </div>
  );
}