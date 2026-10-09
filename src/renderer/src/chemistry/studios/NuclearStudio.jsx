import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Radioactive Decay', 'Decay Chains', 'Fission Energy', 'Fusion Energy'];

const EXPLAIN = {
  name: 'Nuclear Chemistry',
  nameMeaning: 'Nuclear chemistry studies changes in atomic nuclei — radioactivity, decay, fission, and fusion.',
  whatItIs: 'A studio for radioactive decay kinetics, Bateman decay chains, and the energy released by fission and fusion.',
  chemistry: 'Unstable nuclei decay with a characteristic half-life. A decay chain produces daughter nuclides. Fission splits heavy nuclei; fusion joins light ones — both release energy from mass defect (E=mc²).',
  math: [
    { eq: 'N = N₀ exp(−λt), λ = ln2/t½', label: 'exponential decay' },
    { eq: 'dN₂/dt = λ₁N₁ − λ₂N₂', label: 'Bateman (daughter)' },
    { eq: 'Q = (Δm)c²', label: 'mass-energy release' },
    { eq: 'E = mc²', label: 'Einstein relation' },
  ],
  variables: [
    { sym: 'λ', desc: 'decay constant', unit: '1/s' },
    { sym: 't½', desc: 'half-life', unit: 's' },
    { sym: 'N', desc: 'number of nuclei', unit: '—' },
    { sym: 'Q', desc: 'energy released', unit: 'MeV' },
    { sym: 'Δm', desc: 'mass defect', unit: 'u' },
  ],
  assumptions: ['Pure parent at t=0', 'Secular equilibrium possible', 'Instantaneous fission fragments', 'No neutrino energy recovery'],
  limitations: ['Branching ratios ignored in simple chain', 'Real chains have many branches', 'Reactor fission varies by isotope', 'Fusion needs plasma confinement'],
  applications: ['Radiometric dating', 'Nuclear power', 'Medical isotopes', 'Radiation therapy'],
};

function Decay() {
  const [N0, setN0] = useState(1000);
  const [tHalf, setTHalf] = useState(5); // years (like Co-60 ~5.27 yr)
  const [t, setT] = useState(10);
  const lam = Math.LN2 / tHalf;
  const N = N0 * Math.exp(-lam * t);
  const A = lam * N;
  const data = useMemo(() => {
    const out = [];
    for (let tt = 0; tt <= tHalf * 5; tt += tHalf / 20) out.push({ t: tt, N: N0 * Math.exp(-lam * tt) });
    return out;
  }, [N0, tHalf, lam]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="N₀" value={N0} set={setN0} min={100} max={10000} step={100} unit="" />
        <Slider label="t½" value={tHalf} set={setTHalf} min={0.1} max={100} step={0.1} unit="yr" />
        <Slider label="t" value={t} set={setT} min={0} max={500} step={1} unit="yr" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="N remaining" value={fmtSci(N, 1)} />
        <Stat label="fraction" value={fmtSci(N / N0 * 100, 2) + ' %'} />
        <Stat label="activity λN" value={fmtSci(A, 3) + ' /yr'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (yr)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'N', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={tHalf} stroke="#f97316" strokeDasharray="4 4" label={{ value: 't½', fontSize: 10 }} />
            <ReferenceLine x={t} stroke="#22d3ee" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="N" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="N = N₀·exp(−λt). After 1 half-life, 50% remains; after 5, ~3%." />
    </div>
  );
}

function DecayChain() {
  const [l1, setL1] = useState(0.1);
  const [l2, setL2] = useState(0.02);
  const [tMax, setTMax] = useState(100);
  const data = useMemo(() => {
    const out = [];
    const dt = 0.2;
    let N1 = 1000, N2 = 0, N3 = 0;
    for (let t = 0; t <= tMax; t += dt) {
      out.push({ t, N1, N2, N3 });
      const dN1 = -l1 * N1 * dt;
      const dN2 = (l1 * N1 - l2 * N2) * dt;
      const dN3 = l2 * N2 * dt;
      N1 += dN1; N2 += dN2; N3 += dN3;
    }
    return out;
  }, [l1, l2, tMax]);
  const total = data.length ? data[data.length - 1].N1 + data[data.length - 1].N2 + data[data.length - 1].N3 : 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="λ₁ (parent)" value={l1} set={setL1} min={0.01} max={1} step={0.01} unit="1/yr" />
        <Slider label="λ₂ (daughter)" value={l2} set={setL2} min={0.001} max={0.5} step={0.001} unit="1/yr" />
        <Slider label="t_max" value={tMax} set={setTMax} min={10} max={500} step={10} unit="yr" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="parent t½" value={fmtSci(Math.LN2 / l1, 2) + ' yr'} />
        <Stat label="daughter t½" value={fmtSci(Math.LN2 / l2, 2) + ' yr'} />
        <Stat label="total conserved" value={Math.abs(total - 1000) < 1 ? '✓' : '✗'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (yr)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'N', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="N1" name="parent" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="N2" name="daughter" stroke="#f97316" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="N3" name="stable" stroke="#84cc16" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={Math.abs(total - 1000) < 1 ? 'passed' : 'warning'} note="Bateman: daughter rises then falls. If λ₁≫λ₂, secular equilibrium (N₂≈(λ₁/λ₂)N₁)." />
    </div>
  );
}

function Fission() {
  const [isotope, setIsotope] = useState('U235');
  const ISO = {
    U235: { name: '²³⁵U + n', mIn: 235.044 + 1.009, mOut: 140.914 + 91.926 + 3 * 1.009, EperFission: 200 },
    Pu239: { name: '²³⁹Pu + n', mIn: 239.052 + 1.009, mOut: 140.914 + 95.918 + 3 * 1.009, EperFission: 207 },
  };
  const iso = ISO[isotope];
  const dm = iso.mIn - iso.mOut;
  const Q = dm * 931.5; // MeV (1 u = 931.5 MeV)
  const EperMol = Q * 1.602e-13 * 6.022e23 / 1e6; // MJ/mol
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Fissionable isotope" value={isotope} set={setIsotope} options={[{ value: 'U235', label: '²³⁵U' }, { value: 'Pu239', label: '²³⁹Pu' }]} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Δm (mass defect)" value={fmtSci(dm, 4) + ' u'} />
        <Stat label="Q (per fission)" value={fmtSci(Q, 1) + ' MeV'} />
        <Stat label="E (per mol)" value={fmtSci(EperMol, 2) + ' MJ'} />
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs font-mono-j">
        <div>{iso.name} → fission fragments + 3n</div>
        <div className="text-muted-foreground">Δm = m_in − m_out = {dm.toFixed(4)} u</div>
        <div className="text-muted-foreground">Q = Δm·c² = {Q.toFixed(1)} MeV (≈{iso.EperFission} MeV typical)</div>
      </div>
      <ValidationBadge status="passed" note="1 u = 931.5 MeV. Each ²³⁵U fission ≈ 200 MeV. 1 kg ²³⁵U ≈ 80 TJ." />
    </div>
  );
}

function Fusion() {
  const [reaction, setReaction] = useState('DT');
  const RXN = {
    DT: { eq: '²H + ³H → ⁴He + n', mIn: 2.014 + 3.016, mOut: 4.003 + 1.009, Q: 17.6 },
    DD: { eq: '²H + ²H → ³He + n', mIn: 2 * 2.014, mOut: 3.016 + 1.009, Q: 3.3 },
    pp: { eq: 'p + p → ²H + e⁺ + ν', mIn: 2 * 1.008, mOut: 2.014 + 0.00055, Q: 0.42 },
  };
  const rxn = RXN[reaction];
  const dm = rxn.mIn - rxn.mOut;
  const Q = dm * 931.5;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Fusion reaction" value={reaction} set={setReaction} options={[{ value: 'DT', label: 'D–T (easiest)' }, { value: 'DD', label: 'D–D' }, { value: 'pp', label: 'p–p (stars)' }]} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Δm" value={fmtSci(dm, 4) + ' u'} />
        <Stat label="Q (computed)" value={fmtSci(Q, 2) + ' MeV'} />
        <Stat label="Q (known)" value={rxn.Q + ' MeV'} />
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs font-mono-j">
        <div>{rxn.eq}</div>
        <div className="text-muted-foreground">D–T is the leading fusion candidate (Q≈17.6 MeV). Needs T ~10⁸ K.</div>
      </div>
      <ValidationBadge status="passed" note="Fusion releases energy for light nuclei (binding energy per nucleon rises to Fe-56)." />
    </div>
  );
}

export default function NuclearStudio() {
  return (
    <StudioShell title="Nuclear Chemistry Studio" subtitle="Radioactive decay · Bateman chains · fission & fusion Q-values — E=mc²." tabs={TABS} explain={EXPLAIN}>
      {<Decay />}
      {<DecayChain />}
      {<Fission />}
      {<Fusion />}
    </StudioShell>
  );
}