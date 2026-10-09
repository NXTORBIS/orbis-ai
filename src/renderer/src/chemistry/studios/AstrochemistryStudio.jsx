import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { CONSTANTS, fmtSci } from '../lib/chemistry/units.js';

const { R } = CONSTANTS;
const TABS = ['Molecular Clouds', 'Reaction Rates (Low T)', 'Atmospheric Escape', 'Prebiotic Inventory'];

const EXPLAIN = {
  name: 'Astrochemistry',
  nameMeaning: 'Astrochemistry studies chemical processes in space — interstellar clouds, planetary atmospheres, and prebiotic molecules.',
  whatItIs: 'A studio for the chemistry of the cosmos: molecular cloud collapse (Jeans), low-temperature reaction rates, atmospheric escape, and prebiotic molecule inventory.',
  chemistry: 'Dense molecular clouds host ion–molecule chemistry at 10–50 K. Reactions have barriers (Arrhenius) but tunnel. Light gases escape planetary gravity. Simple organics seed life.',
  math: [
    { eq: 'M_J = (5kT/(Gμm_H))^(3/2) · (3/(4πρ))^(1/2)', label: 'Jeans mass' },
    { eq: 'k = A exp(−Ea/RT)', label: 'Arrhenius (low T)' },
    { eq: 'v_esc = √(2GM/r)', label: 'escape velocity' },
    { eq: 'v_rms = √(3kT/m)', label: 'thermal speed' },
  ],
  variables: [
    { sym: 'M_J', desc: 'Jeans mass', unit: 'M☉' },
    { sym: 'T', desc: 'cloud temperature', unit: 'K' },
    { sym: 'n', desc: 'number density', unit: '/cm³' },
    { sym: 'v_esc', desc: 'escape velocity', unit: 'km/s' },
  ],
  assumptions: ['Isothermal, uniform cloud', 'Arrhenius valid (classical)', 'Maxwellian atmosphere', 'Steady prebiotic inventory'],
  limitations: ['Real clouds have turbulence & magnetic fields', 'Tunneling dominates below ~20 K', 'Hydrodynamic escape is complex', 'Delivery rates uncertain'],
  applications: ['Star formation', 'Planetary atmospheres', 'Origin of life', 'Exoplanet characterisation'],
};

const G = 6.674e-11;
const k_B = 1.381e-23;
const mH = 1.673e-27;
const Msun = 1.989e30;

function Clouds() {
  const [T, setT] = useState(20);
  const [n, setN] = useState(1e4);
  const mu = 2.3;
  const rho = n * 1e6 * mu * mH;
  const MJ = useMemo(() => {
    const term1 = (5 * k_B * T) / (G * mu * mH);
    const term2 = 3 / (4 * Math.PI * rho);
    return (Math.pow(term1, 1.5) * Math.pow(term2, 0.5)) / Msun;
  }, [T, rho]);
  const data = useMemo(() => {
    const out = [];
    for (let nn = 1e2; nn <= 1e6; nn = nn * 1.2) {
      const rr = nn * 1e6 * mu * mH;
      const mj = (Math.pow((5 * k_B * T) / (G * mu * mH), 1.5) * Math.pow(3 / (4 * Math.PI * rr), 0.5)) / Msun;
      out.push({ n: Math.log10(nn), MJ: mj });
    }
    return out;
  }, [T]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="T (cloud temp)" value={T} set={setT} min={5} max={100} step={1} unit="K" />
        <Slider label="n (density)" value={n} set={setN} min={100} max={1e6} step={100} unit="/cm³" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="M_J (Jeans)" value={fmtSci(MJ, 2) + ' M☉'} />
        <Stat label="ρ" value={fmtSci(rho, 2) + ' kg/m³'} />
        <Stat label="collapse if" value={MJ < 1 ? 'likely' : 'stable'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="n" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'log₁₀(n /cm³)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} scale="log" domain={['auto', 'auto']} label={{ value: 'M_J (M☉)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={Math.log10(n)} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="MJ" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Denser & colder → smaller Jeans mass → easier collapse. Dense cores (~10⁵/cm³) form solar-mass stars." />
    </div>
  );
}

function Rates() {
  const [A, setA] = useState(1e-10);
  const [Ea, setEa] = useState(2000);
  const [T, setT] = useState(20);
  const k = A * Math.exp(-Ea / T);
  const data = useMemo(() => {
    const out = [];
    for (let t = 5; t <= 200; t += 2) out.push({ T: t, k: A * Math.exp(-Ea / t) });
    return out;
  }, [A, Ea]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="A (pre-exponential)" value={A} set={setA} min={1e-12} max={1e-8} step={1e-12} unit="cm³/s" />
        <Slider label="Ea/R (barrier)" value={Ea} set={setEa} min={100} max={10000} step={100} unit="K" />
        <Slider label="T" value={T} set={setT} min={5} max={200} step={1} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="k at T" value={fmtSci(k, 3) + ' cm³/s'} />
        <Stat label="k at 300 K" value={fmtSci(A * Math.exp(-Ea / 300), 3)} />
        <Stat label="ratio (300/T)" value={fmtSci((A * Math.exp(-Ea / 300)) / k, 2)} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="T" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'T (K)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} scale="log" domain={['auto', 'auto']} label={{ value: 'k', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={T} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="k" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="At 10–50 K, classical Arrhenius rates are tiny — tunneling & ion–molecule (barrierless) routes dominate." />
    </div>
  );
}

function Escape() {
  const [M, setM] = useState(5.97e24);
  const [r, setR] = useState(6.371e6);
  const [T, setT] = useState(1000);
  const vesc = Math.sqrt((2 * G * M) / r) / 1000;
  const molecules = [
    { name: 'H₂', m: 2 * mH },
    { name: 'He', m: 4 * mH },
    { name: 'O₂', m: 32 * mH },
    { name: 'N₂', m: 28 * mH },
  ];
  const vrms = (m) => Math.sqrt((3 * k_B * T) / m) / 1000;
  const data = molecules.map((mol) => ({ name: mol.name, vesc, vrms: vrms(mol.m), ratio: vesc / vrms(mol.m) }));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="M (planet)" value={M} set={setM} min={1e22} max={1e27} step={1e23} unit="kg" />
        <Slider label="r (radius)" value={r} set={setR} min={1e6} max={1e8} step={1e6} unit="m" />
        <Slider label="T (exosphere)" value={T} set={setT} min={200} max={3000} step={50} unit="K" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="v_esc" value={fmtSci(vesc, 2) + ' km/s'} />
        <Stat label="v_rms (H₂)" value={fmtSci(vrms(2 * mH), 2) + ' km/s'} />
        <Stat label="retains H₂?" value={vesc / vrms(2 * mH) > 6 ? 'yes' : 'no'} />
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 p-2 text-[11px]">
        <div className="mb-1 text-muted-foreground">Escape rule of thumb: retained if v_esc / v_rms {'>'} 6 (Jeans escape).</div>
        <div className="grid grid-cols-4 gap-2">
          {data.map((d) => (
            <div key={d.name} className="rounded bg-card/60 px-2 py-1 text-center">
              <div className="font-semibold">{d.name}</div>
              <div className="text-muted-foreground">v_rms {d.vrms.toFixed(1)}</div>
              <div className={d.ratio > 6 ? 'text-emerald-500' : 'text-amber-500'}>{d.ratio > 6 ? 'retained' : 'escapes'}</div>
            </div>
          ))}
        </div>
      </div>
      <ValidationBadge status="passed" note="Earth retains O₂/N₂ but loses H₂/He. Mars (low M) lost most atmosphere." />
    </div>
  );
}

const PREBIOTIC = [
  { name: 'H₂O (water)', source: 'comets/asteroids', abundance: 'high' },
  { name: 'HCN', source: 'photochemistry', abundance: 'medium' },
  { name: 'HCHO (formaldehyde)', source: 'cloud ice', abundance: 'medium' },
  { name: 'NH₃ (ammonia)', source: 'ices', abundance: 'low' },
  { name: 'CH₃OH (methanol)', source: 'grain surface', abundance: 'high' },
  { name: 'amino acids', source: 'meteorites', abundance: 'trace' },
];

function Prebiotic() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Interstellar chemistry produces simple organics that are delivered to young planets by comets and meteorites — the raw ingredients for prebiotic chemistry.</p>
      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/40">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="px-2 py-1">Molecule</th><th className="px-2 py-1">Source</th><th className="px-2 py-1">Abundance</th></tr></thead>
          <tbody>
            {PREBIOTIC.map((p) => (
              <tr key={p.name} className="border-t border-border/40">
                <td className="px-2 py-1 font-mono-j">{p.name}</td>
                <td className="px-2 py-1">{p.source}</td>
                <td className="px-2 py-1">{p.abundance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ValidationBadge status="passed" note="Over 200 molecules detected in interstellar/circumstellar space (2024). Murchison meteorite had 80+ amino acids." />
    </div>
  );
}

export default function AstrochemistryStudio() {
  return (
    <StudioShell title="Astrochemistry Studio" subtitle="Molecular clouds · low-T kinetics · atmospheric escape · prebiotic molecules." tabs={TABS} explain={EXPLAIN}>
      {<Clouds />}
      {<Rates />}
      {<Escape />}
      {<Prebiotic />}
    </StudioShell>
  );
}