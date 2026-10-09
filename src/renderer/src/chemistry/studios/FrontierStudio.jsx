import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { CONSTANTS, fmtSci } from '../lib/chemistry/units.js';

const { R, F } = CONSTANTS;
const TABS = ['CO₂ Reduction', 'Artificial Photosynthesis', 'Catalysis Challenges', 'Open Problems'];

const EXPLAIN = {
  name: 'Frontier Chemistry',
  nameMeaning: 'Frontier chemistry tackles the open, high-impact problems that define the field\'s leading edge.',
  whatItIs: 'A studio for computational exploration of frontier challenges: electrochemical CO₂ reduction, artificial photosynthesis efficiency, catalytic scaling, and open research questions.',
  chemistry: 'CO₂ reduction converts a greenhouse gas to fuels. Artificial photosynthesis mimics nature\'s water splitting + CO₂ fixation. Catalysis is limited by the Sabatier volcano. These are unsolved at industrial scale.',
  math: [
    { eq: 'CO₂ + 2H⁺ + 2e⁻ → CO + H₂O', label: '2-electron CO₂ reduction' },
    { eq: 'η = (chemical energy out)/(solar in)', label: 'photosynthesis efficiency' },
    { eq: 'rate ∝ exp(−ΔG‡/RT)', label: 'catalytic rate (Sabatier)' },
    { eq: 'E°(CO₂/CO) = −0.11 V', label: 'thermodynamic potential' },
  ],
  variables: [
    { sym: 'η', desc: 'efficiency', unit: '%' },
    { sym: 'ΔG‡', desc: 'activation barrier', unit: 'eV' },
    { sym: 'E', desc: 'potential', unit: 'V' },
    { sym: 'FE', desc: 'Faradaic efficiency', unit: '%' },
  ],
  assumptions: ['Thermodynamic limits (no overpotential)', 'Sabatier principle (optimal binding)', 'AM1.5 solar spectrum', 'Single-electron steps'],
  limitations: ['Real devices have overpotential & losses', 'Selectivity competes with H₂ evolution', 'Catalyst stability limits lifetime', 'Scaling laws are empirical'],
  applications: ['Carbon-neutral fuels', 'Renewable energy storage', 'Green chemistry', 'Industrial decarbonisation'],
};

function CO2Reduction() {
  const [E, setE] = useState(-1.1); // applied potential vs SHE
  const [FE, setFE] = useState(80); // Faradaic efficiency %
  const [I, setI] = useState(100); // current mA
  const Eeq = -0.11; // CO2/CO
  const overpotential = Math.abs(E - Eeq);
  const rateCO = (I / 1000) * (FE / 100) / (2 * F); // mol/s (2e- per CO)
  const energyEff = (Eeq / E) * (FE / 100) * 100;
  const data = useMemo(() => {
    const out = [];
    for (let e = -0.2; e >= -2; e -= 0.05) out.push({ E: e, over: Math.abs(e - Eeq), rate: (I / 1000) * (FE / 100) / (2 * F) });
    return out;
  }, [I, FE]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="E (applied)" value={E} set={setE} min={-2} max={-0.2} step={0.01} unit="V" />
        <Slider label="FE (Faradaic eff.)" value={FE} set={setFE} min={10} max={100} step={1} unit="%" />
        <Slider label="I (current)" value={I} set={setI} min={1} max={1000} step={1} unit="mA" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="overpotential" value={fmtSci(overpotential, 3) + ' V'} />
        <Stat label="CO rate" value={fmtSci(rateCO, 3) + ' mol/s'} />
        <Stat label="energy eff." value={fmtSci(energyEff, 1) + ' %'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="E" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'E (V)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'overpotential (V)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={Eeq} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'E°', fontSize: 10 }} />
            <ReferenceLine x={E} stroke="#22d3ee" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="over" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={overpotential < 0.5 ? 'passed' : 'warning'} note="Lower overpotential = better catalyst. E°(CO₂/CO)=−0.11 V. H₂ evolution competes (E°=0 V)." />
    </div>
  );
}

function Photosynthesis() {
  const [lightInt, setLightInt] = useState(1000); // W/m2
  const [PCE, setPCE] = useState(10); // % photoconversion
  const [area, setArea] = useState(1); // m2
  const chemOut = (lightInt * area) * (PCE / 100); // W
  const data = useMemo(() => {
    const out = [];
    for (let p = 0; p <= 30; p += 0.5) out.push({ PCE: p, power: (lightInt * area) * (p / 100) });
    return out;
  }, [lightInt, area]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="light intensity" value={lightInt} set={setLightInt} min={100} max={1500} step={10} unit="W/m²" />
        <Slider label="η (PCE)" value={PCE} set={setPCE} min={0.1} max={30} step={0.1} unit="%" />
        <Slider label="area" value={area} set={setArea} min={0.1} max={100} step={0.1} unit="m²" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="chemical power" value={fmtSci(chemOut, 2) + ' W'} />
        <Stat label="vs natural" value={PCE > 1 ? `${fmtSci(PCE / 0.5, 1)}× natural` : 'below natural'} />
        <Stat label="H₂ rate (est.)" value={fmtSci(chemOut / 237000 * 3600, 3) + ' mol/m²h'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="PCE" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'η (%)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'power (W)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={PCE} stroke="#22d3ee" strokeDasharray="4 4" />
            <ReferenceLine x={0.5} stroke="#84cc16" strokeDasharray="4 4" label={{ value: 'natural', fontSize: 10 }} />
            <Line type="monotone" dataKey="power" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={PCE > 5 ? 'passed' : 'warning'} note="Natural photosynthesis η≈0.5–1%. Best artificial systems reach ~15%. Target: >10% for viability." />
    </div>
  );
}

function Catalysis() {
  const [dG, setDG] = useState(0.8); // eV optimal
  const [T, setT] = useState(500);
  const kB = 8.617e-5; // eV/K
  const rate = Math.exp(-dG / (kB * T));
  const data = useMemo(() => {
    const out = [];
    for (let g = 0.1; g <= 2; g += 0.02) out.push({ dG: g, rate: Math.exp(-g / (kB * T)) });
    return out;
  }, [T]);
  // Sabatier volcano: rate peaks at optimal binding
  const volcano = useMemo(() => {
    const out = [];
    for (let g = 0.1; g <= 2; g += 0.02) {
      // volcano: too weak (high dG) slow, too strong (low dG) poisons
      const bind = Math.exp(-Math.pow((g - dG) / 0.3, 2));
      out.push({ dG: g, volcano: bind });
    }
    return out;
  }, [dG]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="ΔG‡ (barrier)" value={dG} set={setDG} min={0.1} max={2} step={0.01} unit="eV" />
        <Slider label="T" value={T} set={setT} min={300} max={1000} step={10} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="relative rate" value={fmtSci(rate, 3)} />
        <Stat label="kT" value={fmtSci(kB * T, 4) + ' eV'} />
        <Stat label="optimal ΔG‡" value="≈ 0.8–1.0 eV" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={volcano} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="dG" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ΔG‡ (eV)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'activity', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={dG} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="volcano" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Sabatier volcano: too weak binding → slow; too strong → poisoning. Peak at optimal ΔG‡." />
    </div>
  );
}

const PROBLEMS = [
  { q: 'Room-temperature superconductors', a: 'No material superconducts at ambient pressure & room T. Hydrides need megabar pressures.' },
  { q: 'Nitrogen fixation without Haber–Bosch', a: 'Biological N₂ fixation (nitrogenase) works at ambient T; industrial needs 450°C, 200 atm. Catalyst goal: ambient, low-P.' },
  { q: 'Plastic upcycling', a: 'Most plastic is downcycled or burned. Selective depolymerisation back to monomers is an open challenge.' },
  { q: 'Water oxidation catalysts', a: 'OER is the bottleneck of water splitting — 4-electron, slow. RuO₂/IrO₂ work but are scarce & expensive.' },
  { q: 'CO₂ to multi-carbon products', a: '2e⁻ CO₂→CO/ formate is mature; C₂+ (ethylene, ethanol) at high FE remains hard.' },
  { q: 'Direct air capture energy', a: 'Capturing 400 ppm CO₂ is thermodynamically costly (~20% of fuel energy). Sorbent & electrochemical approaches compete.' },
];

function OpenProblems() {
  return (
    <div className="space-y-2">
      {PROBLEMS.map((p) => (
        <div key={p.q} className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="text-sm font-semibold text-cyan-j">{p.q}</div>
          <div className="mt-1 text-xs text-muted-foreground">{p.a}</div>
        </div>
      ))}
      <ValidationBadge status="passed" note="These are active research frontiers — no industrial solution yet exists for any." />
    </div>
  );
}

export default function FrontierStudio() {
  return (
    <StudioShell title="Frontier Chemistry Studio" subtitle="CO₂ reduction · artificial photosynthesis · catalysis volcanoes · open problems." tabs={TABS} explain={EXPLAIN}>
      {<CO2Reduction />}
      {<Photosynthesis />}
      {<Catalysis />}
      {<OpenProblems />}
    </StudioShell>
  );
}