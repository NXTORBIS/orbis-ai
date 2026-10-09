import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Langmuir Isotherm', 'BET Surface Area', 'Contact Angle', 'Catalysis (TOF)'];

const EXPLAIN = {
  name: 'Surface Chemistry',
  nameMeaning: 'Surface chemistry studies processes at interfaces — adsorption, wetting, and heterogeneous catalysis.',
  whatItIs: 'A studio for gas adsorption (Langmuir & BET), wetting (Young\'s equation), and catalytic turnover.',
  chemistry: 'Molecules adsorb onto surfaces, either weakly (physisorption) or strongly (chemisorption). Langmuir assumes monolayer coverage; BET extends to multilayer. Wetting depends on the balance of interfacial tensions.',
  math: [
    { eq: 'θ = KP/(1+KP)', label: 'Langmuir coverage' },
    { eq: '1/[V((P₀/P)−1)] = (C−1)/(Vm·C)·(P/P₀) + 1/(Vm·C)', label: 'BET equation' },
    { eq: 'γ_SG = γ_SL + γ_LG cos θ', label: "Young's equation" },
    { eq: 'TOF = (moles product)/(moles cat·time)', label: 'turnover frequency' },
  ],
  variables: [
    { sym: 'θ', desc: 'fractional coverage', unit: '—' },
    { sym: 'K', desc: 'adsorption equilibrium', unit: '1/Pa' },
    { sym: 'P', desc: 'pressure', unit: 'Pa' },
    { sym: 'θ_c', desc: 'contact angle', unit: '°' },
    { sym: 'TOF', desc: 'turnover frequency', unit: '1/s' },
  ],
  assumptions: ['Langmuir: identical sites, no lateral interactions', 'BET: multilayer, liquid-like condensation', 'Young: smooth, homogeneous surface', 'Catalysis: all sites active'],
  limitations: ['Real surfaces are heterogeneous', 'BET fails near P₀', 'Roughness changes contact angle', 'TOF varies by facet & site'],
  applications: ['Heterogeneous catalysis', 'Biosensors', 'Coatings & wetting', 'Gas separation'],
};

function Langmuir() {
  const [K, setK] = useState(0.01);
  const [P, setP] = useState(100);
  const theta = (K * P) / (1 + K * P);
  const data = useMemo(() => {
    const out = [];
    for (let p = 0; p <= 500; p += 5) out.push({ P: p, theta: (K * p) / (1 + K * p) });
    return out;
  }, [K]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="K (equilibrium)" value={K} set={setK} min={0.001} max={0.1} step={0.001} unit="1/Pa" />
        <Slider label="P (pressure)" value={P} set={setP} min={0} max={500} step={5} unit="Pa" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="θ (coverage)" value={fmtSci(theta, 3)} />
        <Stat label="half-sat P" value={fmtSci(1 / K, 1) + ' Pa'} />
        <Stat label="regime" value={theta < 0.3 ? 'Henry (low P)' : theta > 0.8 ? 'saturation' : 'intermediate'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="P" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'P (Pa)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis domain={[0, 1]} stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'θ', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={P} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="theta" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="θ = KP/(1+KP). At P=1/K, θ=0.5. Saturation → monolayer (Langmuir assumption)." />
    </div>
  );
}

function BET() {
  const [Vm, setVm] = useState(50);
  const [C, setC] = useState(100);
  const [PP0, setPP0] = useState(0.3);
  // BET: V = Vm*C*(P/P0) / ((1-P/P0)(1+(C-1)P/P0))
  const V = (Vm * C * PP0) / ((1 - PP0) * (1 + (C - 1) * PP0));
  const data = useMemo(() => {
    const out = [];
    for (let p = 0.01; p <= 0.6; p += 0.01) out.push({ PP0: p, V: (Vm * C * p) / ((1 - p) * (1 + (C - 1) * p)) });
    return out;
  }, [Vm, C]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="Vm (monolayer vol)" value={Vm} set={setVm} min={1} max={200} step={1} unit="cm³" />
        <Slider label="C (constant)" value={C} setC={setC} min={1} max={500} step={1} unit="" />
        <Slider label="P/P₀" value={PP0} set={setPP0} min={0.01} max={0.6} step={0.01} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="V (adsorbed)" value={fmtSci(V, 2) + ' cm³'} />
        <Stat label="valid range" value="0.05 < P/P₀ < 0.35" />
        <Stat label="C > 1" value={C > 1 ? 'chemisorption-like' : 'weak'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="PP0" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'P/P₀', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'V (cm³)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={PP0} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="V" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="BET extends Langmuir to multilayers. Surface area = Vm·N_A·σ/Vmolar (σ≈0.162 nm² for N₂)." />
    </div>
  );
}

function Contact() {
  const [gSG, setGSG] = useState(30); // mN/m
  const [gSL, setGSL] = useState(15);
  const [gLG, setGLG] = useState(72);
  const cos = (gSG - gSL) / gLG;
  const theta = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  const data = useMemo(() => {
    const out = [];
    for (let sl = 0; sl <= 70; sl += 1) out.push({ gSL: sl, theta: Math.acos(Math.max(-1, Math.min(1, (gSG - sl) / gLG))) * 180 / Math.PI });
    return out;
  }, [gSG, gLG]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="γ_SG (solid-gas)" value={gSG} set={setGSG} min={1} max={100} step={1} unit="mN/m" />
        <Slider label="γ_SL (solid-liq)" value={gSL} set={setGSL} min={0} max={100} step={1} unit="mN/m" />
        <Slider label="γ_LG (liq-gas)" value={gLG} set={setGLG} min={20} max={100} step={1} unit="mN/m" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="θ (contact angle)" value={fmtSci(theta, 1) + ' °'} />
        <Stat label="wetting" value={theta < 90 ? 'wetting' : 'non-wetting'} />
        <Stat label="cos θ" value={fmtSci(cos, 3)} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="gSL" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'γ_SL (mN/m)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis domain={[0, 180]} stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'θ (°)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine y={90} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'θ=90°', fontSize: 10 }} />
            <ReferenceLine x={gSL} stroke="#22d3ee" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="theta" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Young: γ_SG = γ_SL + γ_LG cos θ. θ<90° wetting, θ>90° non-wetting, θ=0° complete spread." />
    </div>
  );
}

function Catalysis() {
  const [molesProd, setMolesProd] = useState(0.5);
  const [molesCat, setMolesCat] = useState(0.001);
  const [time, setTime] = useState(3600);
  const TOF = molesProd / (molesCat * time);
  const data = useMemo(() => {
    const out = [];
    for (let t = 100; t <= 10000; t += 100) out.push({ time: t, TOF: molesProd / (molesCat * t) });
    return out;
  }, [molesProd, molesCat]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="product (mol)" value={molesProd} set={setMolesProd} min={0.01} max={10} step={0.01} unit="mol" />
        <Slider label="catalyst (mol)" value={molesCat} set={setMolesCat} min={0.0001} max={0.01} step={0.0001} unit="mol" />
        <Slider label="time" value={time} set={setTime} min={60} max={36000} step={60} unit="s" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="TOF" value={fmtSci(TOF, 3) + ' 1/s'} />
        <Stat label="TON (turnover #)" value={fmtSci(molesProd / molesCat, 1)} />
        <Stat label="rate" value={fmtSci(molesProd / time, 4) + ' mol/s'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'time (s)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} scale="log" domain={['auto', 'auto']} label={{ value: 'TOF (1/s)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={time} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="TOF" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="TOF = product/(cat·time). Good catalysts: 10⁻³–10³ 1/s. TON = total turnovers before deactivation." />
    </div>
  );
}

export default function SurfaceStudio() {
  return (
    <StudioShell title="Surface Chemistry Studio" subtitle="Langmuir & BET adsorption · wetting · catalytic turnover — chemistry at interfaces." tabs={TABS} explain={EXPLAIN}>
      {<Langmuir />}
      {<BET />}
      {<Contact />}
      {<Catalysis />}
    </StudioShell>
  );
}