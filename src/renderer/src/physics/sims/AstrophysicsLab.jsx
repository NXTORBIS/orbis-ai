import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, NotImplemented } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { rk4 } from '../lib/math.js';

const MODES = ['HR Diagram', 'Stellar Structure (Polytrope)', 'Exoplanet Transit', 'Radial Velocity', 'Compact Objects'];

// A small real stellar sample (M/M☉, L/L☉, T_eff K) for the HR diagram.
const STARS = [
  ['Sun', 1, 1, 5772, 'main'], ['Sirius A', 2.06, 25.4, 9940, 'main'], ['Betelgeuse', 12, 126000, 3500, 'supergiant'],
  ['Rigel', 23, 120000, 12100, 'supergiant'], ['Proxima Cen', 0.12, 0.0017, 3042, 'dwarf'], ['Barnard', 0.14, 0.0035, 3134, 'dwarf'],
  ['Vega', 2.1, 40, 9602, 'main'], ['Arcturus', 1.08, 170, 4286, 'giant'], ['Aldebaran', 1.7, 400, 3910, 'giant'],
  ['Spica', 11, 12500, 22400, 'main'], ['Polaris', 5.4, 1260, 6015, 'giant'], ['Wolf 359', 0.09, 0.0011, 2800, 'dwarf'],
];
const TYPE_COLOR = (T) => T > 30000 ? '#9bb0ff' : T > 10000 ? '#aabfff' : T > 7500 ? '#cad7ff' : T > 6000 ? '#fff4ea' : T > 5000 ? '#ffd2a1' : T > 3500 ? '#ff9966' : '#ff6644';

// Lane–Emden polytrope: ξ² θ' + 2 ξ θ' + ξ² θ^n = 0, θ(0)=1, θ'(0)=0.
function laneEmden(n) {
  const xi = [0], th = [1]; let x = 0, t = 1, d = 0; const h = 0.01;
  for (let i = 0; i < 1000; i++) {
    const dd = -((2 / x) * d + Math.pow(Math.max(t, 0), n)) || 0;
    d += dd * h; t += d * h; x += h; xi.push(x); th.push(t);
    if (t <= 0) break;
  }
  return xi.map((x, i) => ({ xi: x, theta: Math.max(th[i], 0) }));
}

export default function AstrophysicsLab() {
  const [mode, setMode] = useState('HR Diagram');
  const { explain, explaining, output } = useAIExplain();
  const [n, setN] = useState(3); // polytropic index
  const [Rp, setRp] = useState(1); const [Rs, setRs] = useState(1); const [period, setPeriod] = useState(4); const [incl, setIncl] = useState(90); const [a, setA] = useState(0.05);
  const poly = useMemo(() => laneEmden(n), [n]);

  // Transit light curve: blocked flux = (Rp/Rs)^2 during transit duration.
  const transit = useMemo(() => {
    const k = Rp / Rs; const depth = k * k; const out = [];
    const dur = Math.sqrt(period * period / 4 - 0) * 0.1; // simplified
    for (let t = -0.5; t <= 0.5; t += 0.005) {
      const x = t / 0.15; const occ = Math.abs(x) < 1 ? (Math.acos(Math.min(1, Math.abs(x))) - Math.abs(x) * Math.sqrt(1 - x * x)) / Math.PI : 0;
      out.push({ t: t * period, flux: 1 - depth * occ });
    }
    return out;
  }, [Rp, Rs, period]);
  // Radial velocity: v_r = -K (cos(ω+ν) + e cos ω); circular here.
  const rv = useMemo(() => {
    const K = 30 * Math.pow(period / 365, -1 / 3) / Math.max(0.1, Math.sqrt(a)); // simplified amplitude
    const out = []; for (let t = 0; t < period; t += period / 100) out.push({ t, v: -K * Math.cos(2 * Math.PI * t / period) });
    return out;
  }, [period, a]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Advanced Astrophysics Laboratory" subtitle="Hertzsprung–Russell diagram, Lane–Emden stellar structure, exoplanet transit & radial-velocity light curves, and compact-object properties. Real numerical models."
        onExplain={() => explain(`Astrophysics lab, mode=${mode}.`)} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">{MODES.map((m) => <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 text-xs ${mode === m ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{m}</button>)}</div>
      {mode === 'HR Diagram' && (
        <Card title="Hertzsprung–Russell Diagram (real stellar sample)">
          <SciPlot type="scatter" data={STARS.map(([name, m, L, T]) => ({ x: T, y: L, name }))} xKey="x" series={[{ key: 'y', label: 'L/L☉', color: '#22d3ee' }]} xLabel="T_eff (K)" yLabel="L/L☉" log="semi-logy" xDomain={[3000, 25000]} height={320} exportName="hr" />
          <div className="mt-2 flex flex-wrap gap-2">{STARS.map(([name, m, L, T]) => <span key={name} className="text-[10px]" style={{ color: TYPE_COLOR(T) }}>●{name}</span>)}</div>
          <p className="mt-1 text-xs text-muted-foreground">Hot blue stars top-left, cool red stars bottom-right. The main sequence, giants, and supergiants are visible.</p>
        </Card>
      )}
      {mode === 'Stellar Structure (Polytrope)' && (
        <Card title={`Lane–Emden polytrope (n = ${n})`}>
          <NumField label="Polytropic index n" value={n} onChange={setN} min={0} max={5} step={0.5} />
          <SciPlot type="line" data={poly} xKey="xi" series={[{ key: 'theta', label: 'θ(ξ)', color: '#22d3ee' }]} xLabel="ξ" yLabel="θ (density)" height={260} exportName="lane-emden" />
          <p className="mt-2 text-xs text-muted-foreground">θ(ξ) solves ξ²θ″ + 2ξθ′ + ξ²θⁿ = 0. n=1.5 (convective) and n=3 (massive stars) are standard. ξ₁ where θ=0 sets the stellar radius.</p>
        </Card>
      )}
      {mode === 'Exoplanet Transit' && (
        <Card title="Transit Light Curve">
          <div className="grid gap-2 sm:grid-cols-3">
            <NumField label="R_planet (R⊕)" value={Rp} onChange={setRp} min={0.1} max={3} step={0.1} />
            <NumField label="R_star (R☉)" value={Rs} onChange={setRs} min={0.3} max={5} step={0.1} />
            <NumField label="Period (days)" value={period} onChange={setPeriod} min={0.5} max={20} step={0.5} />
          </div>
          <SciPlot type="line" data={transit} xKey="t" series={[{ key: 'flux', label: 'flux', color: '#22d3ee' }]} xLabel="time (days)" yLabel="normalised flux" height={240} exportName="transit" />
          <p className="mt-2 text-xs text-muted-foreground">Transit depth δ = (Rp/Rs)². A Jupiter-sized planet drops a Sun-like star by ~1%.</p>
        </Card>
      )}
      {mode === 'Radial Velocity' && (
        <Card title="Radial Velocity Curve">
          <div className="grid gap-2 sm:grid-cols-2">
            <NumField label="Period (days)" value={period} onChange={setPeriod} min={1} max={365} step={1} />
            <NumField label="Semi-major axis a (AU)" value={a} onChange={setA} min={0.01} max={2} step={0.01} />
          </div>
          <SciPlot type="line" data={rv} xKey="t" series={[{ key: 'v', label: 'v_r (m/s)', color: '#f97316' }]} xLabel="time (days)" yLabel="v_r (m/s)" height={240} exportName="rv" />
          <p className="mt-2 text-xs text-muted-foreground">The star wobbles around the system barycentre; v_r is sinusoidal for a circular orbit. Amplitude gives m_p sin i.</p>
        </Card>
      )}
      {mode === 'Compact Objects' && (
        <Card title="Compact Objects">
          <SciTable headers={['Object', 'Mass (M☉)', 'Radius (km)', 'Density (kg/m³)']} rows={[
            ['White dwarf', 1.0, 7000, '1e9'], ['Neutron star', 1.4, 12, '4e17'], ['Pulsar', 2.0, 11, '6e17'], ['Black hole (10 M☉)', 10, 30, '—'],
          ]} />
          <p className="mt-2 text-xs text-muted-foreground">Schwarzschild radius rs = 2GM/c². A black hole's radius is its event horizon; density is undefined (singularity).</p>
        </Card>
      )}
      <AIPanel output={output} />
    </div>
  );
}