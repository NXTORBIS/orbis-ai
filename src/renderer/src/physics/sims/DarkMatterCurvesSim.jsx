import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Dark matter rotation curves: v(r) = sqrt(G M(r) / r)
// M(r) = M_disk(1 - (1+r/Rd)e^{-r/Rd}) + M_halo (r/(r+Rh))^2
// Disk-only falls off Keplerian (1/sqrt(r)); halo keeps it flat
export default function DarkMatterCurvesSim() {
  const [Mdisk, setMdisk] = useState(1e11);
  const [Rdisk, setRdisk] = useState(5);
  const [Mhalo, setMhalo] = useState(5e11);
  const [Rhalo, setRhalo] = useState(30);
  const { explain, explaining, output } = useAIExplain();

  const G = 4.3e-6; // kpc (km/s)^2 / Msun

  const curve = useMemo(() => {
    const out = [];
    for (let r = 0.5; r <= 50; r += 0.5) {
      const Md = Mdisk * (1 - (1 + r / Rdisk) * Math.exp(-r / Rdisk));
      const Mh = Mhalo * Math.pow(r / (r + Rhalo), 2);
      const vDisk = Math.sqrt(G * Md / r);
      const vTotal = Math.sqrt(G * (Md + Mh) / r);
      const vKepler = Math.sqrt(G * Mdisk / r);
      out.push({ r: +r.toFixed(1), disk: +vDisk.toFixed(1), total: +vTotal.toFixed(1), kepler: +vKepler.toFixed(1) });
    }
    return out;
  }, [Mdisk, Rdisk, Mhalo, Rhalo]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Dark Matter Rotation Curves" subtitle="Galaxies rotate too fast for their visible mass. The flat rotation curve at large radii is evidence for a dark matter halo extending far beyond the visible disk."
        onExplain={() => explain(`Rotation curve: Mdisk=${Mdisk.toExponential(1)} Msun, Rdisk=${Rdisk} kpc, Mhalo=${Mhalo.toExponential(1)} Msun, Rhalo=${Rhalo} kpc. Disk-only (orange) falls off Keplerian. Adding the dark matter halo (cyan) keeps the curve flat — the classic evidence for dark matter.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Galaxy Parameters">
            <NumField label="M disk" value={Mdisk} onChange={setMdisk} min={1e10} max={5e11} step={1e10} unit="Msun" />
            <div className="mt-2"><NumField label="R disk" value={Rdisk} onChange={setRdisk} min={2} max={20} step={1} unit="kpc" /></div>
            <div className="mt-2"><NumField label="M halo" value={Mhalo} onChange={setMhalo} min={0} max={2e12} step={1e11} unit="Msun" /></div>
            <div className="mt-2"><NumField label="R halo" value={Rhalo} onChange={setRhalo} min={5} max={80} step={1} unit="kpc" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['M_disk/M_halo', (Mdisk / Mhalo).toFixed(3)],
            ['v_max (disk)', Math.sqrt(G * Mdisk / Rdisk).toFixed(0) + ' km/s'],
            ['v_max (total)', Math.sqrt(G * (Mdisk + Mhalo) / Rdisk).toFixed(0) + ' km/s'],
            ['Halo extends', Rhalo + ' kpc'],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={curve} xKey="r" series={[
            { key: 'kepler', label: 'Keplerian (point mass)', color: '#94a3b8' },
            { key: 'disk', label: 'Disk only', color: '#f97316' },
            { key: 'total', label: 'Disk + halo', color: '#22d3ee' },
          ]} xLabel="r (kpc)" yLabel="v (km/s)" height={300} exportName="rotation-curve" />
          <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            v(r) = sqrt(G M(r) / r). The disk mass (exponential profile) produces a curve that rises then falls Keplerian (1/sqrt(r)). The dark matter halo (NFW-like profile) adds mass at large radii, keeping v flat — matching observations (e.g., Rubin & Ford, 1970).
          </p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}