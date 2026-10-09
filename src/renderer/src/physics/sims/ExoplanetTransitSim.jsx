import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Exoplanet transit: flux dip when planet crosses star disk
// Depth delta = (Rp/Rs)^2, duration depends on inclination and period
export default function ExoplanetTransitSim() {
  const [Rp, setRp] = useState(1); // Earth radii
  const [Rs, setRs] = useState(1); // Solar radii
  const [period, setPeriod] = useState(4); // days
  const [incl, setIncl] = useState(90); // inclination degrees
  const { explain, explaining, output } = useAIExplain();

  const transit = useMemo(() => {
    const Rearth = 6371, Rsun = 696340;
    const rp = Rp * Rearth, rs = Rs * Rsun;
    const k = rp / rs;
    const depth = k * k;
    const inclRad = (incl * Math.PI) / 180;
    const b = Math.cos(inclRad); // impact parameter
    const out = [];
    const halfDur = 0.08 * Math.sqrt(period); // simplified transit duration
    for (let t = -0.5; t <= 0.5; t += 0.002) {
      const x = t / halfDur;
      let occ = 0;
      if (Math.abs(x) < 1 && Math.abs(b) < 1) {
        const d = Math.abs(x);
        if (d + k < 1 - b) occ = 1; // full transit
        else if (d < 1 + k) {
          // partial (limb)
          const arg = Math.min(1, Math.max(-1, (d * d + 1 - k * k) / (2 * d)));
          occ = (Math.acos(arg) - d * Math.sqrt(1 - arg * arg)) / Math.PI;
        }
      }
      out.push({ t: +(t * period).toFixed(3), flux: +(1 - depth * occ).toFixed(6) });
    }
    return out;
  }, [Rp, Rs, period, incl]);

  const depth = Math.pow((Rp * 6371) / (Rs * 696340), 2);
  const snr = depth * 1e6 / 200; // simplified SNR (ppm vs noise)

  return (
    <div className="space-y-4">
      <ResearchHeader title="Exoplanet Transit — Light Curve" subtitle="When a planet crosses its host star, the star dims slightly. The depth gives the planet-to-star radius ratio; the duration gives the orbital inclination."
        onExplain={() => explain(`Transit: Rp=${Rp} Earth radii, Rs=${Rs} Sun radii, P=${period}d, incl=${incl}°. Depth=${(depth * 1e6).toFixed(0)} ppm. A Jupiter-sized planet drops a Sun-like star by ~1%. Lower inclination causes a shallower, shorter transit.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="System Parameters">
            <NumField label="R_planet" value={Rp} onChange={setRp} min={0.1} max={3} step={0.1} unit="R_earth" />
            <div className="mt-2"><NumField label="R_star" value={Rs} onChange={setRs} min={0.3} max={5} step={0.1} unit="R_sun" /></div>
            <div className="mt-2"><NumField label="Period" value={period} onChange={setPeriod} min={0.5} max={20} step={0.5} unit="days" /></div>
            <div className="mt-2"><NumField label="Inclination" value={incl} onChange={setIncl} min={80} max={90} step={0.5} unit="°" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Depth', (depth * 1e6).toFixed(1) + ' ppm'],
            ['Rp/Rs', ((Rp * 6371) / (Rs * 696340)).toFixed(4)],
            ['Duration', (0.16 * Math.sqrt(period)).toFixed(2) + ' d'],
            ['SNR est', snr.toFixed(1)],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={transit} xKey="t" series={[{ key: 'flux', label: 'flux', color: '#22d3ee' }]} xLabel="time (days)" yLabel="normalized flux" height={280} exportName="transit" />
          <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Transit depth = (Rp/Rs)². A Jupiter (11 R⊕) drops a Sun-like star by ~1%. The flat bottom is full transit; the slopes are ingress/egress. Lower inclination (grazing transit) reduces depth and duration.
          </p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}