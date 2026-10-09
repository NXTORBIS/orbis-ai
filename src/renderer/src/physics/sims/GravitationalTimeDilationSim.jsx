import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Gravitational time dilation: dt_far / dt_near = 1 / sqrt(1 - rs/r)
// Clocks run slower in stronger gravity. GPS satellites need this correction.
// t(r) = t_infinity * sqrt(1 - rs/r)
export default function GravitationalTimeDilationSim() {
  const [M, setM] = useState(1); // mass in solar masses
  const [r, setR] = useState(10); // radius in Schwarzschild radii
  const { explain, explaining, output } = useAIExplain();

  const rs = 2.95 * M; // Schwarzschild radius in km

  const dilationData = useMemo(() => {
    const out = [];
    for (let ri = 1.01; ri <= 50; ri += 0.2) {
      const factor = Math.sqrt(1 - 1 / ri);
      const drift = (1 / factor - 1) * 1e6; // ppm
      out.push({ r: +ri.toFixed(2), rate: +factor.toFixed(6), drift: +drift.toFixed(1) });
    }
    return out;
  }, []);

  const gpsData = useMemo(() => {
    // GPS satellites at ~20,200 km altitude, Earth rs ~ 8.87 mm
    const Rearth = 6371; // km
    const Rs_earth = 0.00887; // km (Schwarzschild radius of Earth)
    const gpsAlt = 20190; // km
    const rSurface = Rearth / Rs_earth; // in units of rs
    const rGPS = (Rearth + gpsAlt) / Rs_earth;
    const rateSurface = Math.sqrt(1 - 1 / rSurface);
    const rateGPS = Math.sqrt(1 - 1 / rGPS);
    const gravDiff = (rateGPS - rateSurface) * 1e6 * 86400; // microseconds/day
    return { rSurface, rGPS, rateSurface, rateGPS, gravDiff };
  }, []);

  const factor = Math.sqrt(1 - 1 / r);
  const drift = (1 / factor - 1) * 1e6; // ppm

  return (
    <div className="space-y-4">
      <ResearchHeader title="Gravitational Time Dilation" subtitle="Clocks run slower in stronger gravity. t(r) = t_inf * sqrt(1 - rs/r). At the event horizon (r=rs), time stops. GPS satellites must correct for this effect."
        onExplain={() => explain(`Time dilation: M=${M} Msun, r=${r} rs. Clock rate = ${factor.toFixed(6)} of distant observer. Drift = ${drift.toFixed(1)} ppm. GPS satellites gain ~${gpsData.gravDiff.toFixed(1)} us/day from gravitational time dilation (plus special relativistic loss from orbital speed).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <NumField label="Mass M" value={M} onChange={setM} min={0.1} max={100} step={0.1} unit="Msun" />
            <div className="mt-2"><NumField label="Radius r" value={r} onChange={setR} min={1.01} max={50} step={0.1} unit="rs" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['rs (Schwarzschild)', rs.toFixed(3) + ' km'],
            ['Clock rate', factor.toFixed(6)],
            ['Drift', drift.toFixed(1) + ' ppm'],
            ['1 day near =', (factor * 24).toFixed(4) + ' h far'],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={dilationData} xKey="r" series={[
            { key: 'rate', label: 'clock rate', color: '#22d3ee' },
            { key: 'drift', label: 'drift (ppm)', color: '#f97316' },
          ]} xLabel="r / rs" yLabel="rate / drift (ppm)" height={260} exportName="time-dilation" />
          <Card title="GPS Correction Example">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Earth surface: clock rate = {gpsData.rateSurface.toFixed(10)}</p>
              <p>GPS orbit (20,200 km): clock rate = {gpsData.rateGPS.toFixed(10)}</p>
              <p>Gravitational gain: +{gpsData.gravDiff.toFixed(1)} microseconds/day</p>
              <p>Without correction, GPS would drift ~{gpsData.gravDiff.toFixed(0)} us/day = ~{(gpsData.gravDiff * 3e8 * 1e-6).toFixed(0)} m/day position error.</p>
            </div>
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
        A clock at radius r (in Schwarzschild radii) runs slow by sqrt(1 - rs/r) relative to a distant observer. Time stops at the event horizon (r = rs). GPS satellites orbit at r ~ 16,000 rs and gain ~45 us/day gravitationally (partially offset by ~7 us/day special-relativistic slowing from orbital speed).
      </p>
      <AIPanel output={output} />
    </div>
  );
}