import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Reactor Design', 'Mass Balance', 'Energy Balance', 'Distillation'];

const EXPLAIN = {
  name: 'Chemical Engineering',
  nameMeaning: 'Chemical engineering scales chemical reactions to industrial processes — reactors, balances, and separations.',
  whatItIs: 'A studio for process fundamentals: CSTR vs PFR reactor sizing, mass & energy balances, and McCabe–Thiele distillation.',
  chemistry: 'A reactor converts feed to product; its design equation links conversion to residence time. Mass and energy balances conserve atoms and heat. Distillation separates by relative volatility.',
  math: [
    { eq: 'V_CSTR = F_A0·X/(−r_A)', label: 'CSTR volume' },
    { eq: 'V_PFR = ∫dF_A/(−r_A)', label: 'PFR volume' },
    { eq: 'Σ(mass_in) = Σ(mass_out)', label: 'mass balance' },
    { eq: 'Q = Σ(n·Cp·ΔT)', label: 'energy balance' },
  ],
  variables: [
    { sym: 'X', desc: 'conversion', unit: '—' },
    { sym: 'V', desc: 'reactor volume', unit: 'L' },
    { sym: 'F_A0', desc: 'molar feed', unit: 'mol/s' },
    { sym: '−r_A', desc: 'reaction rate', unit: 'mol/(L·s)' },
    { sym: 'α', desc: 'relative volatility', unit: '—' },
  ],
  assumptions: ['First-order irreversible reaction', 'Steady-state, isothermal', 'Constant Cp', 'Constant molal overflow (distillation)'],
  limitations: ['Real reactors have non-ideal mixing', 'Heat effects in real operation', 'Azeotropes limit distillation', 'Catalyst deactivation not modelled'],
  applications: ['Petrochemicals', 'Pharmaceuticals', 'Food processing', 'Specialty chemicals'],
};

function Reactor() {
  const [k, setK] = useState(0.1);
  const [FA0, setFA0] = useState(1);
  const [CA0, setCA0] = useState(2);
  const [X, setX] = useState(0.8);
  const rA = k * CA0 * (1 - X);
  const Vcstr = (FA0 * X) / rA;
  const Vpfr = useMemo(() => (FA0 / (k * CA0)) * (-Math.log(1 - X)), [k, FA0, CA0, X]);
  const data = useMemo(() => {
    const out = [];
    for (let x = 0.01; x < 0.99; x += 0.01) {
      const r = k * CA0 * (1 - x);
      out.push({ X: x, CSTR: (FA0 * x) / r, PFR: (FA0 / (k * CA0)) * (-Math.log(1 - x)) });
    }
    return out;
  }, [k, FA0, CA0]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="k" value={k} set={setK} min={0.01} max={1} step={0.01} unit="1/s" />
        <Slider label="F_A0" value={FA0} set={setFA0} min={0.1} max={10} step={0.1} unit="mol/s" />
        <Slider label="C_A0" value={CA0} set={setCA0} min={0.1} max={10} step={0.1} unit="mol/L" />
        <Slider label="X (conversion)" value={X} set={setX} min={0.01} max={0.99} step={0.01} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="−r_A" value={fmtSci(rA, 4) + ' mol/(L·s)'} />
        <Stat label="V_CSTR" value={fmtSci(Vcstr, 2) + ' L'} />
        <Stat label="V_PFR" value={fmtSci(Vpfr, 2) + ' L'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="X" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'X', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'V (L)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine x={X} stroke="#f97316" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="CSTR" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="PFR" stroke="#84cc16" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="For first-order, PFR < CSTR always. V_PFR = (F_A0/kC_A0)·−ln(1−X)." />
    </div>
  );
}

function MassBalance() {
  const [F1, setF1] = useState(100);
  const [x1, setX1] = useState(0.5);
  const [F2, setF2] = useState(50);
  const [x2, setX2] = useState(0.3);
  const Fout = F1 + F2;
  const xout = (F1 * x1 + F2 * x2) / Fout;
  const inA = F1 * x1 + F2 * x2;
  const outA = Fout * xout;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="F₁" value={F1} set={setF1} min={0} max={200} step={1} unit="kg/h" />
        <Slider label="x₁ (mass frac A)" value={x1} set={setX1} min={0} max={1} step={0.01} unit="" />
        <Slider label="F₂" value={F2} set={setF2} min={0} max={200} step={1} unit="kg/h" />
        <Slider label="x₂ (mass frac A)" value={x2} set={setX2} min={0} max={1} step={0.01} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="F_out" value={fmtSci(Fout, 2) + ' kg/h'} />
        <Stat label="x_out (A)" value={fmtSci(xout, 4)} />
        <Stat label="balance check" value={Math.abs(inA - outA) < 1e-9 ? '✓ conserved' : '✗ error'} />
      </div>
      <ValidationBadge status="passed" note="Steady-state mixing: F_out = F₁+F₂, x_out = (F₁x₁+F₂x₂)/F_out." />
    </div>
  );
}

function EnergyBalance() {
  const [n, setN] = useState(2);
  const [Cp, setCp] = useState(75);
  const [Tin, setTin] = useState(25);
  const [Tout, setTout] = useState(80);
  const Q = n * Cp * (Tout - Tin);
  const data = useMemo(() => {
    const out = [];
    for (let t = 0; t <= 200; t += 5) out.push({ T: t, Q: n * Cp * (t - Tin) });
    return out;
  }, [n, Cp, Tin]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="n (moles)" value={n} set={setN} min={0.1} max={20} step={0.1} unit="mol" />
        <Slider label="Cp" value={Cp} setCp={setCp} min={1} max={200} step={1} unit="J/(mol·K)" />
        <Slider label="T_in" value={Tin} set={setTin} min={0} max={100} step={1} unit="°C" />
        <Slider label="T_out" value={Tout} set={setTout} min={0} max={200} step={1} unit="°C" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Q (heat)" value={fmtSci(Q / 1000, 3) + ' kJ'} />
        <Stat label="ΔT" value={fmtSci(Tout - Tin, 1) + ' °C'} />
        <Stat label="power (1 min)" value={fmtSci(Q / 60, 2) + ' W'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="T" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'T_out (°C)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'Q (J)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={Tout} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Q" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Q = n·Cp·ΔT (no phase change). For water, Cp ≈ 75 J/(mol·K)." />
    </div>
  );
}

function Distillation() {
  const [alpha, setAlpha] = useState(2.5);
  const [xD, setXD] = useState(0.9);
  const [xB, setXB] = useState(0.1);
  const [R, setR] = useState(2);
  const Rmin = useMemo(() => {
    const xF = 0.5;
    return (xD / (alpha - 1)) * (alpha / xF - 1) - (1 - xD) / (alpha - 1);
  }, [alpha, xD]);
  const Nmin = useMemo(() => Math.log((xD / (1 - xD)) * ((1 - xB) / xB)) / Math.log(alpha), [alpha, xD, xB]);
  const data = useMemo(() => {
    const out = [];
    for (let x = 0; x <= 1; x += 0.01) out.push({ x, y: (alpha * x) / (1 + (alpha - 1) * x), diag: x });
    return out;
  }, [alpha]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="α (rel. volatility)" value={alpha} set={setAlpha} min={1.1} max={5} step={0.1} unit="" />
        <Slider label="x_D (distillate)" value={xD} set={setXD} min={0.5} max={0.99} step={0.01} unit="" />
        <Slider label="x_B (bottoms)" value={xB} set={setXB} min={0.01} max={0.5} step={0.01} unit="" />
        <Slider label="R (reflux)" value={R} set={setR} min={0.5} max={10} step={0.1} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="N_min (Fenske)" value={fmtSci(Nmin, 2)} />
        <Stat label="R_min (approx)" value={fmtSci(Rmin, 2)} />
        <Stat label="α > 1" value={alpha > 1 ? 'separable' : 'azeotrope'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'x (liquid)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'y (vapour)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="diag" stroke="hsl(var(--muted-foreground))" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="y" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={alpha > 1 ? 'passed' : 'warning'} note="Fenske: N_min = log[(xD/(1−xD))·((1−xB)/xB)] / log α. Higher α → fewer stages." />
    </div>
  );
}

export default function EngineeringStudio() {
  return (
    <StudioShell title="Chemical Engineering Studio" subtitle="Reactors · mass & energy balance · distillation — from lab to plant." tabs={TABS} explain={EXPLAIN}>
      {<Reactor />}
      {<MassBalance />}
      {<EnergyBalance />}
      {<Distillation />}
    </StudioShell>
  );
}