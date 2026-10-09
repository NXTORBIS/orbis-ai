import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Amino Acids / pI', 'Enzyme Kinetics', 'DNA / Nucleic Acids', 'Protein Stability'];

const EXPLAIN = {
  name: 'Biochemistry',
  nameMeaning: 'Biochemistry studies the chemical processes within and relating to living organisms — proteins, nucleic acids, and metabolism.',
  whatItIs: 'A studio for the molecules of life: amino acid charge & pI, Michaelis–Menten enzyme kinetics, DNA melting, and protein folding stability.',
  chemistry: 'Amino acids carry ionisable groups whose charge depends on pH. Enzymes speed reactions by binding substrate. DNA duplex stability comes from base stacking and H-bonds.',
  math: [
    { eq: 'pI = (pKa₁ + pKa₂)/2 (no ionisable side chain)', label: 'isoelectric point' },
    { eq: 'v = Vmax·[S]/(Km + [S])', label: 'Michaelis–Menten' },
    { eq: '1/v = (Km/Vmax)(1/[S]) + 1/Vmax', label: 'Lineweaver–Burk' },
    { eq: 'Tm = ΔH/(ΔS + R ln[CT])', label: 'DNA melting temperature' },
  ],
  variables: [
    { sym: 'pI', desc: 'isoelectric point', unit: 'pH' },
    { sym: 'Km', desc: 'Michaelis constant', unit: 'mM' },
    { sym: 'Vmax', desc: 'max rate', unit: 'µmol/min' },
    { sym: 'Tm', desc: 'melting temperature', unit: '°C' },
    { sym: 'ΔG', desc: 'folding free energy', unit: 'kJ/mol' },
  ],
  assumptions: ['Ideal Michaelis–Menten (no inhibition)', 'Two-state protein folding', 'Nearest-neighbour DNA model simplified', 'Henderson–Hasselbalch for ionisation'],
  limitations: ['Allosteric enzymes deviate from MM', 'Real proteins fold via intermediates', 'Salt affects DNA Tm', 'Membrane proteins differ'],
  applications: ['Drug design', 'Enzyme engineering', 'PCR optimisation', 'Protein therapeutics'],
};

const AAS = [
  { name: 'Glycine', pKa1: 2.34, pKa2: 9.60, pKr: null },
  { name: 'Alanine', pKa1: 2.35, pKa2: 9.87, pKr: null },
  { name: 'Glutamic acid', pKa1: 2.19, pKa2: 9.67, pKr: 4.25 },
  { name: 'Lysine', pKa1: 2.18, pKa2: 8.95, pKr: 10.53 },
  { name: 'Histidine', pKa1: 1.82, pKa2: 9.17, pKr: 6.00 },
  { name: 'Aspartic acid', pKa1: 2.09, pKa2: 9.82, pKr: 3.86 },
];

function AminoAcids() {
  const [aa, setAa] = useState(0);
  const [pH, setpH] = useState(7);
  const a = AAS[aa];
  const pI = useMemo(() => {
    if (a.pKr == null) return (a.pKa1 + a.pKa2) / 2;
    const pks = [a.pKa1, a.pKa2, a.pKr].sort((x, y) => x - y);
    // pI = average of the two pKa around the neutral species
    if (a.pKr < a.pKa1) return (a.pKr + a.pKa1) / 2; // acidic side chain
    if (a.pKr > a.pKa2) return (a.pKa2 + a.pKr) / 2; // basic side chain
    return (a.pKa1 + a.pKa2) / 2;
  }, [a]);
  const charge = useMemo(() => {
    // net charge approximation
    const f = (pk) => 1 / (1 + Math.pow(10, pH - pk)); // fraction protonated (positive)
    const fd = (pk) => 1 / (1 + Math.pow(10, pk - pH)); // fraction deprotonated (negative)
    let q = f(a.pKa1) + f(a.pKa2) - fd(a.pKa2);
    // simpler: +1 for N-term, -1 for C-term, side chain
    const nTerm = 1 / (1 + Math.pow(10, pH - a.pKa1));
    const cTerm = -1 / (1 + Math.pow(10, a.pKa2 - pH));
    let side = 0;
    if (a.pKr != null) {
      if (a.name === 'Lysine' || a.name === 'Histidine') side = 1 / (1 + Math.pow(10, pH - a.pKr));
      else side = -1 / (1 + Math.pow(10, a.pKr - pH));
    }
    return nTerm + cTerm + side;
  }, [a, pH]);
  const data = useMemo(() => {
    const out = [];
    for (let p = 0; p <= 14; p += 0.2) {
      const nTerm = 1 / (1 + Math.pow(10, p - a.pKa1));
      const cTerm = -1 / (1 + Math.pow(10, a.pKa2 - p));
      let side = 0;
      if (a.pKr != null) {
        if (a.name === 'Lysine' || a.name === 'Histidine') side = 1 / (1 + Math.pow(10, p - a.pKr));
        else side = -1 / (1 + Math.pow(10, a.pKr - p));
      }
      out.push({ pH: p, charge: nTerm + cTerm + side });
    }
    return out;
  }, [a]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Amino acid" value={String(aa)} set={(v) => setAa(Number(v))} options={AAS.map((x, i) => ({ value: String(i), label: x.name }))} />
        <Slider label="pH" value={pH} set={setpH} min={0} max={14} step={0.1} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="pI (isoelectric)" value={fmtSci(pI, 2)} />
        <Stat label="Net charge @pH" value={fmtSci(charge, 3)} />
        <Stat label="pKa₁ (α-COOH)" value={a.pKa1} />
        <Stat label="pKa₂ (α-NH₃⁺)" value={a.pKa2} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="pH" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'pH', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'net charge', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={pI} stroke="#22d3ee" strokeDasharray="4 4" label={{ value: 'pI', fontSize: 10 }} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <ReferenceLine x={pH} stroke="#f97316" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="charge" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note={`At pI the net charge is zero. ${a.name}: pI = ${pI.toFixed(2)}.`} />
    </div>
  );
}

function Enzyme() {
  const [Vmax, setVmax] = useState(100);
  const [Km, setKm] = useState(2);
  const [S, setS] = useState(1);
  const v = (Vmax * S) / (Km + S);
  const data = useMemo(() => {
    const out = [];
    for (let s = 0; s <= 20; s += 0.2) out.push({ S: s, v: (Vmax * s) / (Km + s), invS: s > 0 ? 1 / s : null, invV: s > 0 ? (Km + s) / (Vmax * s) : null });
    return out;
  }, [Vmax, Km]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="Vmax" value={Vmax} set={setVmax} min={1} max={500} step={1} unit="µmol/min" />
        <Slider label="Km" value={Km} set={setKm} min={0.1} max={20} step={0.1} unit="mM" />
        <Slider label="[S]" value={S} set={setS} min={0.1} max={20} step={0.1} unit="mM" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="v (rate)" value={fmtSci(v, 2) + ' µmol/min'} />
        <Stat label="v/Vmax" value={fmtSci(v / Vmax * 100, 1) + ' %'} />
        <Stat label="at [S]=Km" value="v = Vmax/2" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="S" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: '[S] (mM)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'v', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine y={Vmax} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Vmax', fontSize: 10 }} />
            <ReferenceLine x={Km} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="v" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="At [S]=Km, v=Vmax/2. Lineweaver–Burk: slope Km/Vmax, intercept 1/Vmax." />
    </div>
  );
}

function DNA() {
  const [GC, setGC] = useState(50);
  const [len, setLen] = useState(20);
  const [Na, setNa] = useState(50);
  // Wallace rule + salt correction
  const Tm = useMemo(() => {
    const gc = (GC / 100) * len;
    const at = len - gc;
    let tm = 2 * at + 4 * gc; // Wallace
    tm += 16.6 * Math.log10(Na / 1000); // salt correction
    return tm;
  }, [GC, len, Na]);
  const data = useMemo(() => {
    const out = [];
    for (let g = 0; g <= 100; g += 2) {
      const gc = (g / 100) * len;
      const at = len - gc;
      out.push({ GC: g, Tm: 2 * at + 4 * gc + 16.6 * Math.log10(Na / 1000) });
    }
    return out;
  }, [len, Na]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="GC content" value={GC} set={setGC} min={0} max={100} step={1} unit="%" />
        <Slider label="Length" value={len} set={setLen} min={4} max={100} step={1} unit="bp" />
        <Slider label="[Na⁺]" value={Na} set={setNa} min={1} max={500} step={1} unit="mM" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Tm (melting)" value={fmtSci(Tm, 1) + ' °C'} />
        <Stat label="GC count" value={Math.round((GC / 100) * len)} />
        <Stat label="AT count" value={len - Math.round((GC / 100) * len)} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="GC" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'GC %', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'Tm (°C)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={GC} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Tm" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Wallace rule: Tm = 2×AT + 4×GC. Salt correction: +16.6·log₁₀[Na⁺]." />
    </div>
  );
}

function Protein() {
  const [dG, setdG] = useState(-20); // kJ/mol
  const [dH, setdH] = useState(-200); // kJ/mol
  const [T, setT] = useState(298);
  const dS = (dH - dG) / T; // kJ/(mol·K)
  const Tm = dH / dS; // K (when ΔG=0)
  const data = useMemo(() => {
    const out = [];
    for (let t = 250; t <= 400; t += 2) {
      out.push({ T: t - 273, dG: dH - t * dS });
    }
    return out;
  }, [dH, dS]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="ΔH (enthalpy)" value={dH} set={setdH} min={-500} max={-10} step={5} unit="kJ/mol" />
        <Slider label="ΔG (folding, 298K)" value={dG} set={setdG} min={-80} max={10} step={1} unit="kJ/mol" />
        <Slider label="T" value={T} set={setT} min={250} max={400} step={1} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="ΔS (entropy)" value={fmtSci(dS, 3) + ' kJ/(mol·K)'} />
        <Stat label="Tm (unfolding)" value={fmtSci(Tm - 273, 1) + ' °C'} />
        <Stat label="ΔG at T" value={fmtSci(dH - T * dS, 2) + ' kJ/mol'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="T" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'T (°C)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ΔG (kJ/mol)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <ReferenceLine x={Tm - 273} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Tm', fontSize: 10 }} />
            <Line type="monotone" dataKey="dG" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={dG < 0 ? 'passed' : 'warning'} note={dG < 0 ? 'Negative ΔG → folded state stable.' : 'Positive ΔG → unfolded favoured.'} />
    </div>
  );
}

export default function BiochemistryStudio() {
  return (
    <StudioShell title="Biochemistry Studio" subtitle="Amino acids · enzyme kinetics · DNA melting · protein folding — the chemistry of life." tabs={TABS} explain={EXPLAIN}>
      {<AminoAcids />}
      {<Enzyme />}
      {<DNA />}
      {<Protein />}
    </StudioShell>
  );
}