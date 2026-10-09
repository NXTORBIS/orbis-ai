import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Neutron star structure: TOV-like model (simplified)
function nsProps(rho_c) {
  const R = 12 * Math.pow(2.8e17 / rho_c, 1 / 3); // km
  const M = 1.4 * Math.pow(rho_c / 2.8e17, 1 / 3); // solar masses
  const rs = 2.95 * M; // Schwarzschild radius in km
  const g = 1.33e12 * M / (R * R); // surface gravity cm/s²
  const vesc = Math.sqrt(2 * 6.67e-11 * M * 1.989e30 / (R * 1000)); // m/s
  const compactness = rs / R;
  return { rho_c, R, M, rs, g, vesc: vesc / 1e8, compactness };
}

export default function NeutronStarsSim() {
  const [rho, setRho] = useState(2.8e17);
  const [view, setView] = useState('structure');
  const { explain, explaining, output } = useAIExplain();

  const props = useMemo(() => nsProps(rho), [rho]);

  const massRadius = useMemo(() => {
    const out = [];
    for (let rc = 1e17; rc <= 1e18; rc *= 1.05) {
      const p = nsProps(rc);
      out.push({ R: +p.R.toFixed(2), M: +p.M.toFixed(3), compact: +p.compactness.toFixed(3) });
    }
    return out;
  }, []);

  const densityProfile = useMemo(() => {
    const out = [];
    for (let r = 0; r <= props.R; r += props.R / 50) {
      const f = r / props.R;
      const rho_r = props.rho_c * (1 - f * f * 0.3);
      out.push({ r: +r.toFixed(2), rho: +rho_r.toExponential(2) });
    }
    return out;
  }, [rho, props.R]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Neutron Stars — Compact Objects" subtitle="Ultra-dense remnants of stellar collapse. A city-sized atomic nucleus with nuclear density, extreme gravity, and magnetic fields."
        onExplain={() => explain(`Neutron star: ρ_c=${rho.toExponential(2)} kg/m³, R=${props.R.toFixed(1)} km, M=${props.M.toFixed(2)} M☉, compactness=${props.compactness.toFixed(3)}. Surface gravity ${props.g.toExponential(2)} cm/s². Escape velocity ${props.vesc.toFixed(1)}×10⁸ m/s.`)} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">
        {['structure', 'mass-radius', 'density'].map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1.5 text-xs ${view === v ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{v === 'structure' ? 'Properties' : v === 'mass-radius' ? 'M-R Curve' : 'Density Profile'}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Central Density">
            <NumField label="rho_central" value={rho} onChange={setRho} min={1e17} max={1e18} step={1e16} unit="kg/m3" />
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Mass', props.M.toFixed(2) + ' Msun'],
            ['Radius', props.R.toFixed(1) + ' km'],
            ['Schwarzschild r', props.rs.toFixed(2) + ' km'],
            ['Compactness', props.compactness.toFixed(3)],
            ['Surface g', props.g.toExponential(2) + ' cm/s2'],
            ['Escape v', props.vesc.toFixed(2) + 'x1e8 m/s'],
          ]} />
        </div>
        <div className="space-y-3">
          {view === 'structure' && (
            <Card title="Neutron Star Structure">
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Crust (0-1 km): Ions + degenerate electrons. Density 1e9-1e14 g/cm3.</p>
                <p>Outer core (1-10 km): Neutron fluid + protons + electrons. Superfluid neutrons.</p>
                <p>Inner core (above 10 km): Possibly exotic matter - hyperons, quark-gluon plasma, or color superconductivity.</p>
                <p className="pt-2">Compactness Rs/R = {props.compactness.toFixed(3)}. When Rs/R approaches 0.5, the star collapses to a black hole.</p>
              </div>
            </Card>
          )}
          {view === 'mass-radius' && (
            <SciPlot type="line" data={massRadius} xKey="R" series={[{ key: 'M', label: 'M(R)', color: '#22d3ee' }]} xLabel="R (km)" yLabel="M (Msun)" height={300} exportName="ns-mass-radius" />
          )}
          {view === 'density' && (
            <SciPlot type="area" data={densityProfile} xKey="r" series={[{ key: 'rho', label: 'rho(r)', color: '#f97316' }]} xLabel="r (km)" yLabel="rho (kg/m3)" height={300} exportName="ns-density" />
          )}
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}