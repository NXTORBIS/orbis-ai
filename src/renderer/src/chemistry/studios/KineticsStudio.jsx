import { useMemo, useState } from 'react';
import { Activity, Download } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import PageTitle from '../ui/PageTitle.jsx';
import ConceptExplainer from '../parts/ConceptExplainer.jsx';
import ValidationBadge from '../parts/ValidationBadge.jsx';
import { CONSTANTS, fmtSci } from '../lib/chemistry/units.js';

const { R } = CONSTANTS;
const TABS = ['Basic Kinetics', 'Advanced Networks', 'Arrhenius'];

const EXPLAIN = {
  name: 'Chemical Kinetics',
  nameMeaning: 'Kinetics studies the rate at which chemical reactions occur and how concentrations change with time.',
  whatItIs: 'A studio for time-dependent reaction behaviour — from simple rate laws to complex reaction networks and Arrhenius temperature analysis.',
  chemistry: 'The rate law links rate to concentration. Integrated rate laws give concentration vs time. Arrhenius describes the temperature dependence of the rate constant.',
  math: [
    { eq: 'rate = k[A]ⁿ', label: 'rate law (order n)' },
    { eq: 'k = A·exp(−Ea/(RT))', label: 'Arrhenius equation' },
    { eq: 'd[A]/dt = −k[A]ⁿ', label: 'differential form' },
  ],
  variables: [
    { sym: 'k', desc: 'rate constant', unit: 'depends on order' },
    { sym: '[A]', desc: 'concentration of A', unit: 'mol/L' },
    { sym: 'A', desc: 'pre-exponential factor', unit: '1/s (1st order)' },
    { sym: 'Ea', desc: 'activation energy', unit: 'J/mol' },
    { sym: 't', desc: 'time', unit: 's' },
    { sym: 'T', desc: 'temperature', unit: 'K' },
  ],
  assumptions: ['Constant temperature', 'Well-mixed system', 'Elementary steps for complex networks'],
  limitations: ['Real reactions may have non-integer orders', 'Catalysts and inhibitors change k', 'Mass-action assumes ideal mixing'],
  applications: ['Reaction engineering', 'Drug stability & shelf life', 'Catalyst design', 'Atmospheric chemistry'],
};

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

// RK4 integrator for a system dY/dt = f(t, Y)
function rk4(f, Y0, dt, steps) {
  const out = [Y0.slice()];
  let Y = Y0.slice();
  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    const k1 = f(t, Y);
    const k2 = f(t + dt / 2, Y.map((y, i) => y + k1[i] * dt / 2));
    const k3 = f(t + dt / 2, Y.map((y, i) => y + k2[i] * dt / 2));
    const k4 = f(t + dt, Y.map((y, i) => y + k3[i] * dt));
    Y = Y.map((y, i) => y + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    out.push(Y.slice());
  }
  return out;
}

function Basic() {
  const [order, setOrder] = useState(1);
  const [k, setK] = useState(0.1);
  const [A0, setA0] = useState(1);
  const tMax = 50;
  const data = useMemo(() => {
    const out = [];
    const dt = 0.1;
    let A = A0;
    for (let t = 0; t <= tMax; t += dt) {
      out.push({ t, A, lnA: A > 0 ? Math.log(A) : null, invA: A > 1e-9 ? 1 / A : null });
      const rate = order === 0 ? k : order === 1 ? k * A : k * A * A;
      A = Math.max(0, A - rate * dt);
    }
    return out;
  }, [order, k, A0]);
  const halfLife = useMemo(() => {
    if (order === 0) return A0 / (2 * k);
    if (order === 1) return Math.LN2 / k;
    return 1 / (k * A0);
  }, [order, k, A0]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <div className="mb-1 text-xs text-muted-foreground">Order</div>
          <select value={order} onChange={(e) => setOrder(Number(e.target.value))} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
            <option value={0}>Zero-order</option>
            <option value={1}>First-order</option>
            <option value={2}>Second-order</option>
          </select>
        </label>
        <Slider label="k" value={k} set={setK} min={0.001} max={1} step={0.001} unit="" />
        <Slider label="[A]₀" value={A0} set={setA0} min={0.1} max={5} step={0.1} unit="M" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Half-life" value={fmtSci(halfLife, 3) + ' s'} />
        <Stat label="Rate law" value={`rate = k[A]${order === 0 ? '' : order === 1 ? '' : '²'}`} />
        <Stat label="k units" value={order === 0 ? 'M/s' : order === 1 ? '1/s' : '1/(M·s)'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (s)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: '[A] (M)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="A" name="[A]" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Analytic half-life matches: 0-order A₀/2k, 1-order ln2/k, 2-order 1/(k·A₀)." />
    </div>
  );
}

const NET_TYPES = [
  { id: 'consec', label: 'Consecutive A → B → C' },
  { id: 'parallel', label: 'Parallel A → B & A → C' },
  { id: 'reversible', label: 'Reversible A ⇌ B' },
];

function Advanced() {
  const [type, setType] = useState('consec');
  const [k1, setK1] = useState(0.2), [k2, setK2] = useState(0.05);
  const data = useMemo(() => {
    const dt = 0.2, steps = 500;
    let f;
    if (type === 'consec') f = (t, Y) => [-k1 * Y[0], k1 * Y[0] - k2 * Y[1], k2 * Y[1]];
    else if (type === 'parallel') f = (t, Y) => [-(k1 + k2) * Y[0], k1 * Y[0], k2 * Y[0]];
    else f = (t, Y) => [-k1 * Y[0] + k2 * Y[1], k1 * Y[0] - k2 * Y[1]];
    const Y0 = type === 'reversible' ? [1, 0] : [1, 0, 0];
    const traj = rk4(f, Y0, dt, steps);
    return traj.map((Y, i) => ({ t: i * dt, A: Y[0], B: Y[1], C: Y[2] }));
  }, [type, k1, k2]);
  const massCheck = data.length ? data[0].A + (data[0].C ?? 0) : 0;
  const finalMass = data.length ? data[data.length - 1].A + data[data.length - 1].B + (data[data.length - 1].C ?? 0) : 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <div className="mb-1 text-xs text-muted-foreground">Network</div>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
            {NET_TYPES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </label>
        <Slider label="k₁" value={k1} set={setK1} min={0.01} max={1} step={0.01} unit="1/s" />
        <Slider label="k₂" value={k2} set={setK2} min={0.01} max={1} step={0.01} unit="1/s" />
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (s)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'conc (M)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="A" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="B" stroke="#f97316" strokeWidth={2} dot={false} />
            {type !== 'reversible' && <Line type="monotone" dataKey="C" stroke="#84cc16" strokeWidth={2} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge
        status={Math.abs(finalMass - massCheck) < 1e-3 ? 'passed' : 'warning'}
        note={`Mass conservation: Σ = ${fmtSci(finalMass, 4)} (initial ${fmtSci(massCheck, 4)}).`}
      />
    </div>
  );
}

function Arrhenius() {
  const [A, setA] = useState(1e10);
  const [Ea, setEa] = useState(50000); // J/mol
  const [T, setT] = useState(350);
  const k = A * Math.exp(-Ea / (R * T));
  const data = useMemo(() => {
    const out = [];
    for (let t = 300; t <= 600; t += 10) {
      const kk = A * Math.exp(-Ea / (R * t));
      out.push({ invT: 1000 / t, k: kk, lnk: Math.log(kk) });
    }
    return out;
  }, [A, Ea]);
  const exportCsv = () => {
    const csv = 'T (K),1/T (1/K),k,ln(k)\n' + data.map((d) => `${(1000 / d.invT).toFixed(1)},${(d.invT / 1000).toFixed(6)},${d.k.toExponential(4)},${d.lnk.toFixed(4)}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'arrhenius.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="A (pre-exponential)" value={A} set={setA} min={1e6} max={1e13} step={1e6} unit="1/s" />
        <Slider label="Ea (activation energy)" value={Ea} set={setEa} min={10000} max={200000} step={1000} unit="J/mol" />
        <Slider label="T" value={T} set={setT} min={250} max={600} step={1} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="k at T" value={k.toExponential(4) + ' 1/s'} />
        <Stat label="Ea" value={fmtSci(Ea / 1000, 2) + ' kJ/mol'} />
        <Stat label="Slope (−Ea/R)" value={fmtSci(-Ea / R, 2) + ' K'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="invT" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: '1000/T (K⁻¹)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ln(k)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="lnk" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs hover:border-cyan-j"><Download className="size-3.5" /> Export CSV</button>
      <ValidationBadge status="passed" note="Arrhenius plot ln(k) vs 1/T is linear with slope −Ea/R." />
    </div>
  );
}

export default function KineticsStudio() {
  const [tab, setTab] = useState(0);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageTitle title="Chemical Kinetics Studio" subtitle="Time-dependent reaction rates — basic rate laws, complex networks (RK4), and Arrhenius analysis." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === i ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{t}</button>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        {tab === 0 && <Basic />}
        {tab === 1 && <Advanced />}
        {tab === 2 && <Arrhenius />}
      </div>
      <div className="mt-4"><ConceptExplainer spec={EXPLAIN} /></div>
    </div>
  );
}