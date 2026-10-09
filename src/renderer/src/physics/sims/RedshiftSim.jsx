import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Cosmological redshift: z = (a_now / a_then) - 1
// For small z: z ~ v/c (Doppler). For large z: cosmological.
// Distance: luminosity distance d_L = c/H0 * integral
// 1 + z = a_obs / a_emit
export default function RedshiftSim() {
  const [z, setZ] = useState(1);
  const [H0, setH0] = useState(70);
  const { explain, explaining, output } = useAIExplain();

  const c = 3e5; // km/s

  const redshiftData = useMemo(() => {
    const out = [];
    for (let zi = 0; zi <= 5; zi += 0.05) {
      // Wavelength stretching: lambda_obs = lambda_emit * (1 + z)
      const lambdaEmit = 500; // nm (green)
      const lambdaObs = lambdaEmit * (1 + zi);
      // Velocity (special relativistic for comparison)
      const beta = ((1 + zi) * (1 + zi) - 1) / ((1 + zi) * (1 + zi) + 1);
      const vSR = beta * c;
      // Luminosity distance (simplified, matter + lambda flat universe)
      const dL = (c / H0) * (zi + 0.5 * (1 - 0.3) * zi * zi) * 1000; // kpc -> Mpc approx
      out.push({ z: +zi.toFixed(2), lambdaObs: +lambdaObs.toFixed(0), vSR: +vSR.toFixed(0), dL: +dL.toFixed(0) });
    }
    return out;
  }, [H0]);

  const lambdaEmit = 500;
  const lambdaObs = lambdaEmit * (1 + z);
  const color = lambdaObs < 450 ? '#9bb0ff' : lambdaObs < 500 ? '#cad7ff' : lambdaObs < 570 ? '#fde047' : lambdaObs < 620 ? '#fb923c' : '#ef4444';

  return (
    <div className="space-y-4">
      <ResearchHeader title="Cosmological Redshift" subtitle="Light stretches as space expands: lambda_obs = lambda_emit * (1 + z). This is NOT the Doppler effect — it's the stretching of spacetime itself."
        onExplain={() => explain(`Redshift z=${z}: emitted lambda=${lambdaEmit}nm (green) observed as lambda=${lambdaObs.toFixed(0)}nm. The photon has been stretched by ${(z * 100).toFixed(0)}%. At z=1, the universe was half its current size. The CMB has z~1100.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Redshift Parameters">
            <NumField label="Redshift z" value={z} onChange={setZ} min={0} max={5} step={0.1} />
            <div className="mt-2"><NumField label="H0" value={H0} onChange={setH0} min={40} max={100} step={1} unit="km/s/Mpc" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['z', z.toFixed(2)],
            ['lambda_emit', lambdaEmit + ' nm'],
            ['lambda_obs', lambdaObs.toFixed(0) + ' nm'],
            ['Scale factor a', (1 / (1 + z)).toFixed(3)],
            ['Lookback time', (z / (1 + z) * 13.8).toFixed(1) + ' Gyr'],
          ]} />
        </div>
        <div className="space-y-3">
          <Card title="Wavelength Stretching">
            <div className="flex items-center gap-4 p-3">
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Emitted</div>
                <div className="w-16 h-8 rounded" style={{ background: '#84cc16' }}></div>
                <div className="text-xs font-mono mt-1">{lambdaEmit} nm</div>
              </div>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Observed (z={z.toFixed(1)})</div>
                <div className="w-16 h-8 rounded" style={{ background: color }}></div>
                <div className="text-xs font-mono mt-1">{lambdaObs.toFixed(0)} nm</div>
              </div>
            </div>
          </Card>
          <SciPlot type="line" data={redshiftData} xKey="z" series={[{ key: 'lambdaObs', label: 'lambda_obs', color: '#22d3ee' }, { key: 'vSR', label: 'v (km/s)', color: '#f97316' }]} xLabel="z" yLabel="lambda (nm) / v (km/s)" height={220} exportName="redshift" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
        Cosmological redshift z = (a_obs / a_emit) - 1. The observed wavelength is longer (redder) because space itself has stretched since the light was emitted. At z=1, the universe was half its current size; the CMB has z~1100. This differs from Doppler shift (special relativity).
      </p>
      <AIPanel output={output} />
    </div>
  );
}