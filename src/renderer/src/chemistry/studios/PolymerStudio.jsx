import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { StudioShell, Slider, Stat, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Molecular Weight / PDI', 'Polymerization Kinetics', 'Chain Dimensions', 'Crosslink Density'];

const EXPLAIN = {
  name: 'Polymer Chemistry',
  nameMeaning: 'Polymer chemistry studies large molecules built from repeating monomer units — their synthesis, size, and physical properties.',
  whatItIs: 'A studio for polymer molecular weight, step-growth kinetics, chain dimensions (radius of gyration), and rubber elasticity (crosslink density).',
  chemistry: 'Step-growth polymerisation links monomers with conversion p; the Carothers equation gives the degree of polymerisation. Chain size scales with the Flory exponent.',
  math: [
    { eq: 'Xn = 1/(1−p)', label: 'Carothers equation (step growth)' },
    { eq: 'PDI = Mw/Mn', label: 'polydispersity index' },
    { eq: 'Rg = b·N^ν', label: 'radius of gyration (Flory)' },
    { eq: 'G = νRT', label: 'rubber elasticity modulus' },
  ],
  variables: [
    { sym: 'Xn', desc: 'number-average DP', unit: '—' },
    { sym: 'p', desc: 'monomer conversion', unit: '—' },
    { sym: 'Mn', desc: 'number-average MW', unit: 'g/mol' },
    { sym: 'Rg', desc: 'radius of gyration', unit: 'nm' },
    { sym: 'ν', desc: 'crosslink density', unit: 'mol/m³' },
  ],
  assumptions: ['Equal monomer reactivity (Flory)', 'Ideal solution (θ-solvent reference)', 'Affine network for elasticity', 'No cyclisation'],
  limitations: ['Real DP deviates near gel point', 'Solvent quality changes ν', 'Network defects (loops) lower G', 'Chain branching not modelled'],
  applications: ['Plastics & rubbers', 'Drug delivery', 'Coatings', 'Fibres'],
};

function MolWeight() {
  const [M0, setM0] = useState(104);
  const [p, setP] = useState(0.99);
  const Xn = 1 / (1 - p);
  const Xw = (1 + p) / (1 - p);
  const Mn = M0 * Xn;
  const Mw = M0 * Xw;
  const PDI = Mw / Mn;
  const data = useMemo(() => {
    const out = [];
    for (let pp = 0.01; pp < 0.999; pp += 0.01) out.push({ p: pp, Xn: 1 / (1 - pp), Xw: (1 + pp) / (1 - pp) });
    return out;
  }, []);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="M₀ (monomer MW)" value={M0} set={setM0} min={28} max={500} step={1} unit="g/mol" />
        <Slider label="p (conversion)" value={p} set={setP} min={0.01} max={0.999} step={0.001} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Xn (DP)" value={fmtSci(Xn, 1)} />
        <Stat label="Mn" value={fmtSci(Mn, 0) + ' g/mol'} />
        <Stat label="Mw" value={fmtSci(Mw, 0) + ' g/mol'} />
        <Stat label="PDI" value={fmtSci(PDI, 3)} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="p" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'p', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'DP', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={p} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Xn" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Xw" stroke="#f97316" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={p < 0.99 ? 'passed' : 'warning'} note="Carothers: Xn=1/(1−p). At p=0.99, Xn=100. PDI→2 as p→1 (Flory)." />
    </div>
  );
}

function Kinetics() {
  const [k, setK] = useState(0.05);
  const [C0, setC0] = useState(2);
  const data = useMemo(() => {
    const out = [];
    for (let t = 0; t <= 100; t += 1) {
      const p = (C0 * k * t) / (1 + C0 * k * t);
      out.push({ t, p, Xn: 1 / (1 - p) });
    }
    return out;
  }, [k, C0]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="k (rate const)" value={k} set={setK} min={0.001} max={0.2} step={0.001} unit="L/(mol·s)" />
        <Slider label="C₀ (monomer)" value={C0} set={setC0} min={0.1} max={10} step={0.1} unit="mol/L" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="p @ 100s" value={fmtSci((C0 * k * 100) / (1 + C0 * k * 100), 3)} />
        <Stat label="Xn @ 100s" value={fmtSci(1 + C0 * k * 100, 1)} />
        <Stat label="Gel point p_c" value="≈ 1/√2 (A-A+B-B)" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (s)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'p', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="p" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Step-growth: p = C₀kt/(1+C₀kt). DP grows linearly with time." />
    </div>
  );
}

function Chain() {
  const [N, setN] = useState(1000);
  const [b, setB] = useState(0.5);
  const [nu, setNu] = useState(0.588);
  const Rg = b * Math.pow(N, nu);
  const data = useMemo(() => {
    const out = [];
    for (let nn = 0.3; nn <= 1; nn += 0.02) out.push({ nu: nn, Rg: b * Math.pow(N, nn) });
    return out;
  }, [b, N]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="N (monomers)" value={N} set={setN} min={10} max={10000} step={10} unit="" />
        <Slider label="b (bond length)" value={b} set={setB} min={0.1} max={2} step={0.01} unit="nm" />
        <Slider label="ν (Flory exp)" value={nu} set={setNu} min={0.33} max={1} step={0.001} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Rg (gyration)" value={fmtSci(Rg, 2) + ' nm'} />
        <Stat label="Rg (ideal ν=0.5)" value={fmtSci(b * Math.sqrt(N), 2) + ' nm'} />
        <Stat label="regime" value={nu < 0.4 ? 'collapsed' : nu > 0.55 ? 'good solvent' : 'θ-solvent'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="nu" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ν', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'Rg (nm)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={nu} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Rg" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Rg = b·N^ν. ν=0.5 (θ), 0.588 (good solvent), 0.33 (collapsed globule)." />
    </div>
  );
}

function Crosslink() {
  const [nu, setNu] = useState(100);
  const [T, setT] = useState(300);
  const R = 8.314;
  const G = nu * R * T;
  const data = useMemo(() => {
    const out = [];
    for (let n = 10; n <= 500; n += 5) out.push({ nu: n, G: n * R * T });
    return out;
  }, [T]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="ν (crosslink density)" value={nu} set={setNu} min={10} max={500} step={5} unit="mol/m³" />
        <Slider label="T" value={T} set={setT} min={200} max={500} step={1} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="G (modulus)" value={fmtSci(G / 1000, 2) + ' kPa'} />
        <Stat label="G (MPa)" value={fmtSci(G / 1e6, 4) + ' MPa'} />
        <Stat label="Mc (MW btwn xlinks)" value={fmtSci(1000 / nu, 1) + ' g/mol'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="nu" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ν (mol/m³)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'G (Pa)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={nu} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="G" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Rubber elasticity: G = νRT. Higher crosslink density → stiffer rubber." />
    </div>
  );
}

export default function PolymerStudio() {
  return (
    <StudioShell title="Polymer Chemistry Studio" subtitle="Molecular weight · step-growth kinetics · chain dimensions · rubber elasticity." tabs={TABS} explain={EXPLAIN}>
      {<MolWeight />}
      {<Kinetics />}
      {<Chain />}
      {<Crosslink />}
    </StudioShell>
  );
}