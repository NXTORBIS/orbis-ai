import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import PageTitle from '../ui/PageTitle.jsx';
import ConceptExplainer from '../parts/ConceptExplainer.jsx';
import ValidationBadge from '../parts/ValidationBadge.jsx';
import { CONSTANTS, fmtSci, fmtUnits } from '../lib/chemistry/units.js';

const { R, F } = CONSTANTS;
const TABS = ['Galvanic Cell', 'Nernst Equation', 'Electrolysis', 'Corrosion'];

const EXPLAIN = {
  name: 'Electrochemistry',
  nameMeaning: 'Electrochemistry studies the interconversion of chemical energy and electrical energy via redox reactions at electrodes.',
  whatItIs: 'Advanced electrochemical modelling — galvanic cells, the Nernst equation, electrolysis (Faraday\'s law) and corrosion.',
  chemistry: 'Redox half-reactions at electrodes generate or consume electrons. The cell potential predicts spontaneity; the Nernst equation adjusts for concentration.',
  math: [
    { eq: 'E°cell = E°cathode − E°anode', label: 'Standard cell potential' },
    { eq: 'ΔG = −nFE', label: 'Free energy from potential' },
    { eq: 'E = E° − (RT/nF) ln Q', label: 'Nernst equation' },
    { eq: 'm = (M·I·t)/(n·F)', label: "Faraday's law of electrolysis" },
  ],
  variables: [
    { sym: 'E', desc: 'electrode/cell potential', unit: 'V' },
    { sym: 'E°', desc: 'standard potential', unit: 'V' },
    { sym: 'n', desc: 'electrons transferred', unit: 'mol e⁻/mol' },
    { sym: 'F', desc: "Faraday's constant", unit: '96485 C/mol' },
    { sym: 'Q', desc: 'reaction quotient', unit: '—' },
    { sym: 'I', desc: 'current', unit: 'A' },
    { sym: 't', desc: 'time', unit: 's' },
    { sym: 'm', desc: 'mass deposited', unit: 'g' },
  ],
  assumptions: ['Standard conditions for E° (1 M, 298 K, 1 atm)', 'Ideal behaviour', 'No overpotential unless modelled'],
  limitations: ['Real cells have overpotential and internal resistance', 'Activity coefficients deviate from 1', 'Side reactions reduce efficiency'],
  applications: ['Batteries & fuel cells', 'Electroplating', 'Corrosion prevention', 'Sensors & pH meters'],
};

// Standard reduction potentials (V)
const HALF_CELLS = [
  { name: 'Zn²⁺/Zn', E: -0.76, n: 2, red: 'Zn²⁺ + 2e⁻ → Zn' },
  { name: 'Fe²⁺/Fe', E: -0.44, n: 2, red: 'Fe²⁺ + 2e⁻ → Fe' },
  { name: 'Cu²⁺/Cu', E: +0.34, n: 2, red: 'Cu²⁺ + 2e⁻ → Cu' },
  { name: 'Ag⁺/Ag', E: +0.80, n: 1, red: 'Ag⁺ + e⁻ → Ag' },
  { name: 'H⁺/H₂', E: 0.00, n: 2, red: '2H⁺ + 2e⁻ → H₂' },
  { name: 'Cl₂/Cl⁻', E: +1.36, n: 2, red: 'Cl₂ + 2e⁻ → 2Cl⁻' },
];

function Slider({ label, value, set, min, max, step, unit }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono-j">{fmtSci(value)} {unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-cyan-500" />
    </label>
  );
}
function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold font-mono-j">{value}</div>
    </div>
  );
}

function Galvanic() {
  const [cathode, setCathode] = useState(3); // Ag
  const [anode, setAnode] = useState(0);    // Zn
  const cat = HALF_CELLS[cathode], an = HALF_CELLS[anode];
  const Ecell = cat.E - an.E;
  const n = Math.min(cat.n, an.n) || 2;
  const dG = -n * F * Ecell;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs text-muted-foreground">Cathode (reduction)</div>
          <select value={cathode} onChange={(e) => setCathode(Number(e.target.value))} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
            {HALF_CELLS.map((h, i) => <option key={i} value={i}>{h.name} (E°={h.E} V)</option>)}
          </select>
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-muted-foreground">Anode (oxidation)</div>
          <select value={anode} onChange={(e) => setAnode(Number(e.target.value))} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
            {HALF_CELLS.map((h, i) => <option key={i} value={i}>{h.name} (E°={h.E} V)</option>)}
          </select>
        </label>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs font-mono-j">
        <div>Cathode: {cat.red}</div>
        <div>Anode (oxidised): {an.red.replace('→', '←')}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="E°cell" value={fmtSci(Ecell, 3) + ' V'} />
        <Stat label="n (electrons)" value={n} />
        <Stat label="ΔG°" value={fmtUnits(dG / 1000, 'kJ/mol', 2)} />
      </div>
      <ValidationBadge status={Ecell > 0 ? 'passed' : 'warning'} note={Ecell > 0 ? 'Positive E°cell → spontaneous galvanic cell.' : 'Negative E°cell → non-spontaneous; swap electrodes or apply external voltage (electrolytic).'} />
    </div>
  );
}

function Nernst() {
  const [E0, setE0] = useState(1.1);   // V (Daniell-ish)
  const [n, setN] = useState(2);
  const [T, setT] = useState(298);
  const [logQ, setLogQ] = useState(0);
  const E = E0 - (R * T / (n * F)) * Math.log(10) * logQ;
  const data = useMemo(() => {
    const out = [];
    for (let q = -10; q <= 10; q += 0.2) out.push({ logQ: q, E: E0 - (R * T / (n * F)) * Math.log(10) * q });
    return out;
  }, [E0, n, T]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="E°" value={E0} set={setE0} min={-2} max={3} step={0.01} unit="V" />
        <Slider label="n" value={n} set={setN} min={1} max={6} step={1} unit="" />
        <Slider label="T" value={T} set={setT} min={250} max={600} step={1} unit="K" />
        <Slider label="log Q" value={logQ} set={setLogQ} min={-10} max={10} step={0.1} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="E at log Q" value={fmtSci(E, 4) + ' V'} />
        <Stat label="(RT/nF)ln10" value={fmtSci((R * T / (n * F)) * Math.log(10), 4) + ' V'} />
        <Stat label="E = E° when" value="Q = 1 (log Q = 0)" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="logQ" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'log Q', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'E (V)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
            <ReferenceLine x={logQ} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="E" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="At 298 K, (RT/F)ln10 ≈ 0.0592 V — the familiar 0.0592/n slope." />
    </div>
  );
}

function Electrolysis() {
  const [I, setI] = useState(2);       // A
  const [t, setT] = useState(3600);     // s
  const [M, setM] = useState(63.55);   // g/mol (Cu)
  const [n, setN] = useState(2);
  const molesE = (I * t) / F;
  const molesM = molesE / n;
  const mass = molesM * M;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="Current I" value={I} set={setI} min={0.1} max={20} step={0.1} unit="A" />
        <Slider label="Time t" value={t} set={setT} min={60} max={7200} step={60} unit="s" />
        <Slider label="Molar mass M" value={M} set={setM} min={1} max={200} step={0.1} unit="g/mol" />
        <Slider label="n (electrons)" value={n} set={setN} min={1} max={4} step={1} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Charge Q = I·t" value={fmtSci(I * t, 3) + ' C'} />
        <Stat label="Moles e⁻" value={fmtSci(molesE, 4) + ' mol'} />
        <Stat label="Mass deposited" value={fmtSci(mass, 4) + ' g'} />
      </div>
      <ValidationBadge status="passed" note="Faraday's law: m = M·I·t/(n·F). 1 mole e⁻ = 96485 C." />
    </div>
  );
}

function Corrosion() {
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(0.1); // mm/year (corrosion rate)
  const loss = rate * years;
  const data = useMemo(() => {
    const out = [];
    for (let y = 0; y <= 50; y += 1) out.push({ year: y, loss: rate * y });
    return out;
  }, [rate]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Corrosion is an electrochemical process where a metal (usually the anode) oxidises, losing thickness over time. The rate depends on environment (humidity, salinity, O₂).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="Corrosion rate" value={rate} set={setRate} min={0.001} max={1} step={0.001} unit="mm/yr" />
        <Slider label="Exposure time" value={years} set={setYears} min={1} max={50} step={1} unit="yr" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Metal loss" value={fmtSci(loss, 3) + ' mm'} />
        <Stat label="Remaining (1 mm plate)" value={fmtSci(Math.max(0, 1 - loss), 3) + ' mm'} />
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="year" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'years', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'loss (mm)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={years} stroke="#ef4444" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Linear corrosion model: loss = rate × time. Real corrosion is often non-linear (pitting, passivation)." />
    </div>
  );
}

export default function ElectrochemistryStudio() {
  const [tab, setTab] = useState(0);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageTitle title="Advanced Electrochemistry" subtitle="Galvanic cells · Nernst equation · electrolysis (Faraday) · corrosion — every variable with units." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === i ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{t}</button>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        {tab === 0 && <Galvanic />}
        {tab === 1 && <Nernst />}
        {tab === 2 && <Electrolysis />}
        {tab === 3 && <Corrosion />}
      </div>
      <div className="mt-4"><ConceptExplainer spec={EXPLAIN} /></div>
    </div>
  );
}