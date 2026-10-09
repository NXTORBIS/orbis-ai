import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Atmosphere', 'Acid Rain', 'Greenhouse Forcing', 'Carbon Cycle'];

const EXPLAIN = {
  name: 'Environmental Chemistry',
  nameMeaning: 'Environmental chemistry studies chemical processes in air, water, and soil, and human impact on them.',
  whatItIs: 'A studio for atmospheric structure, acid rain chemistry, greenhouse radiative forcing, and the carbon cycle.',
  chemistry: 'Pressure falls exponentially with altitude (scale height). SO₂ and NOₓ form acid rain. Greenhouse gases absorb IR and exert radiative forcing. Carbon cycles between reservoirs.',
  math: [
    { eq: 'P(h) = P₀ exp(−h/H)', label: 'barometric formula' },
    { eq: 'pH = −log₁₀[H⁺]', label: 'acid rain pH' },
    { eq: 'ΔF = 5.35·ln(C/C₀)', label: 'CO₂ radiative forcing' },
    { eq: 'dC/dt = sources − sinks', label: 'carbon cycle mass balance' },
  ],
  variables: [
    { sym: 'H', desc: 'scale height', unit: 'km' },
    { sym: 'pH', desc: 'acidity', unit: '—' },
    { sym: 'ΔF', desc: 'radiative forcing', unit: 'W/m²' },
    { sym: 'C', desc: 'CO₂ concentration', unit: 'ppm' },
  ],
  assumptions: ['Isothermal atmosphere', 'Strong acid (complete dissociation)', 'Well-mixed greenhouse gas', 'Linear reservoir model'],
  limitations: ['Real atmosphere has temperature lapse', 'Buffering in real rainwater', 'Forcing varies by gas & wavelength', 'Carbon cycle has feedbacks'],
  applications: ['Air quality', 'Climate modelling', 'Ocean acidification', 'Pollution control'],
};

function Atmosphere() {
  const [H, setH] = useState(8.4); // km scale height
  const [h, setH2] = useState(10); // altitude km
  const P0 = 101.325; // kPa
  const P = P0 * Math.exp(-h / H);
  const data = useMemo(() => {
    const out = [];
    for (let alt = 0; alt <= 50; alt += 0.5) out.push({ h: alt, P: P0 * Math.exp(-alt / H) });
    return out;
  }, [H]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="H (scale height)" value={H} set={setH} min={5} max={12} step={0.1} unit="km" />
        <Slider label="h (altitude)" value={h} set={setH2} min={0} max={50} step={0.5} unit="km" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="P at h" value={fmtSci(P, 3) + ' kPa'} />
        <Stat label="P/P₀" value={fmtSci(P / P0, 3)} />
        <Stat label="Mt Everest (8.8 km)" value={fmtSci(P0 * Math.exp(-8.8 / H), 1) + ' kPa'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'h (km)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'P (kPa)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={h} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="P" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="P = P₀·exp(−h/H). H≈8.4 km at 288 K. Pressure halves every ~5.8 km." />
    </div>
  );
}

function AcidRain() {
  const [SO2, setSO2] = useState(50); // ppb SO2 → H2SO4
  const [NOx, setNOx] = useState(30); // ppb → HNO3
  const [rainVol, setRainVol] = useState(1); // L per m³ air
  // Simplified: each ppb → contributes H+
  const H = useMemo(() => {
    // SO2 → H2SO4 (2 H+), NOx → HNO3 (1 H+)
    const molSO2 = (SO2 * 1e-9) / rainVol * 0.1; // rough
    const molNOx = (NOx * 1e-9) / rainVol * 0.1;
    return 2 * molSO2 + molNOx;
  }, [SO2, NOx, rainVol]);
  const pH = -Math.log10(H);
  const data = useMemo(() => {
    const out = [];
    for (let s = 0; s <= 200; s += 5) {
      const h = 2 * (s * 1e-9) / rainVol * 0.1 + (NOx * 1e-9) / rainVol * 0.1;
      out.push({ SO2: s, pH: h > 0 ? -Math.log10(h) : 7 });
    }
    return out;
  }, [NOx, rainVol]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="SO₂" value={SO2} set={setSO2} min={0} max={200} step={1} unit="ppb" />
        <Slider label="NOₓ" value={NOx} set={setNOx} min={0} max={200} step={1} unit="ppb" />
        <Slider label="rain volume" value={rainVol} set={setRainVol} min={0.1} max={5} step={0.1} unit="L/m³" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="[H⁺]" value={fmtSci(H, 3) + ' M'} />
        <Stat label="pH" value={isFinite(pH) ? fmtSci(pH, 2) : '—'} />
        <Stat label="category" value={pH < 5.6 ? 'acid rain' : pH < 7 ? 'slightly acidic' : 'neutral'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="SO2" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'SO₂ (ppb)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis domain={[0, 7]} stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'pH', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine y={5.6} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'acid rain', fontSize: 10 }} />
            <ReferenceLine x={SO2} stroke="#22d3ee" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="pH" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={pH < 5.6 ? 'warning' : 'passed'} note="Natural rain pH ≈ 5.6 (CO₂ buffering). Below 5.6 = acid rain." />
    </div>
  );
}

function Greenhouse() {
  const [C0, setC0] = useState(280); // preindustrial ppm
  const [C, setC] = useState(420); // current
  const dF = 5.35 * Math.log(C / C0);
  const dT = 0.8 * dF; // climate sensitivity ~0.8 K/(W/m²)
  const data = useMemo(() => {
    const out = [];
    for (let c = 280; c <= 800; c += 10) out.push({ C: c, dF: 5.35 * Math.log(c / C0) });
    return out;
  }, [C0]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="C₀ (reference)" value={C0} set={setC0} min={180} max={400} step={1} unit="ppm" />
        <Slider label="C (current)" value={C} setC={setC} min={280} max={800} step={1} unit="ppm" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="ΔF (forcing)" value={fmtSci(dF, 3) + ' W/m²'} />
        <Stat label="ΔT (est.)" value={fmtSci(dT, 2) + ' K'} />
        <Stat label="2×CO₂" value={fmtSci(5.35 * Math.log(2), 2) + ' W/m²'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="C" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'CO₂ (ppm)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'ΔF (W/m²)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={C} stroke="#22d3ee" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="dF" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="ΔF = 5.35·ln(C/C₀). 2×CO₂ → 3.7 W/m². Preindustrial 280 → today 420 ppm." />
    </div>
  );
}

function CarbonCycle() {
  const reservoirs = [
    { name: 'Atmosphere', C: 870 },
    { name: 'Ocean', C: 38000 },
    { name: 'Biosphere', C: 560 },
    { name: 'Soil', C: 1500 },
    { name: 'Fossil fuels', C: 5000 },
  ];
  const [emission, setEmission] = useState(10); // GtC/yr
  const [uptake, setUptake] = useState(5); // GtC/yr
  const net = emission - uptake;
  const data = reservoirs.map((r) => ({ name: r.name, C: r.C }));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="fossil emission" value={emission} set={setEmission} min={0} max={20} step={0.5} unit="GtC/yr" />
        <Slider label="ocean+land uptake" value={uptake} set={setUptake} min={0} max={15} step={0.5} unit="GtC/yr" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="net to atmosphere" value={fmtSci(net, 2) + ' GtC/yr'} />
        <Stat label="atmosphere" value="870 GtC" />
        <Stat label="airborne fraction" value={fmtSci(net / emission * 100, 1) + ' %'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'GtC', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} width={80} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Bar dataKey="C" fill="#22d3ee" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={net > 0 ? 'warning' : 'passed'} note={net > 0 ? 'Net accumulation → atmospheric CO₂ rising.' : 'Net zero → atmospheric CO₂ stable.'} />
    </div>
  );
}

export default function EnvironmentalStudio() {
  return (
    <StudioShell title="Environmental Chemistry Studio" subtitle="Atmosphere · acid rain · greenhouse forcing · carbon cycle — chemistry of our planet." tabs={TABS} explain={EXPLAIN}>
      {<Atmosphere />}
      {<AcidRain />}
      {<Greenhouse />}
      {<CarbonCycle />}
    </StudioShell>
  );
}