import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Titration', 'Chromatography', 'Gravimetric Analysis', 'Calibration / Regression'];

const EXPLAIN = {
  name: 'Analytical Chemistry',
  nameMeaning: 'Analytical chemistry develops and applies methods to identify and quantify matter — titration, separation, and calibration.',
  whatItIs: 'A studio for the classical quantitative toolkit: acid–base titration curves, chromatographic resolution, gravimetric yield, and linear calibration.',
  chemistry: 'A titration tracks pH as titrant neutralises analyte. Chromatography separates by differential partitioning. Gravimetry weighs a precipitate. Calibration maps signal to concentration.',
  math: [
    { eq: 'V_eq = C_a·V_a/C_b', label: 'equivalence volume' },
    { eq: 'Rs = 2(tR₂−tR₁)/(w₁+w₂)', label: 'chromatographic resolution' },
    { eq: '%analyte = GF·m_precip/m_sample × 100', label: 'gravimetric yield' },
    { eq: 'y = mx + b (least squares)', label: 'calibration line' },
  ],
  variables: [
    { sym: 'V_eq', desc: 'equivalence volume', unit: 'mL' },
    { sym: 'Rs', desc: 'resolution', unit: '—' },
    { sym: 'tR', desc: 'retention time', unit: 'min' },
    { sym: 'N', desc: 'theoretical plates', unit: '—' },
    { sym: 'GF', desc: 'gravimetric factor', unit: '—' },
  ],
  assumptions: ['Strong acid + strong base', 'Gaussian peak shape', 'Stoichiometric precipitate', 'Linear detector response'],
  limitations: ['Polyprotic acids need stepwise treatment', 'Tailing peaks reduce Rs', 'Co-precipitation biases gravimetry', 'Non-linear at high concentration'],
  applications: ['Quality control', 'Pharmaceutical assay', 'Environmental monitoring', 'Forensics'],
};

function Titration() {
  const [Ca, setCa] = useState(0.1);
  const [Va, setVa] = useState(25);
  const [Cb, setCb] = useState(0.1);
  const [Vb, setVb] = useState(12.5);
  const Veq = (Ca * Va) / Cb;
  const pH = useMemo(() => {
    const molesA = (Ca * Va) / 1000;
    const molesB = (Cb * Vb) / 1000;
    const Vtot = (Va + Vb) / 1000;
    if (molesB < molesA) return -Math.log10((molesA - molesB) / Vtot);
    if (molesB > molesA) return 14 + Math.log10((molesB - molesA) / Vtot);
    return 7;
  }, [Ca, Va, Cb, Vb]);
  const data = useMemo(() => {
    const out = [];
    for (let v = 0; v <= Veq * 2; v += 0.5) {
      const molesA = (Ca * Va) / 1000;
      const molesB = (Cb * v) / 1000;
      const Vtot = (Va + v) / 1000;
      let p;
      if (v === 0) p = -Math.log10(Ca);
      else if (molesB < molesA) p = -Math.log10((molesA - molesB) / Vtot);
      else if (molesB > molesA) p = 14 + Math.log10((molesB - molesA) / Vtot);
      else p = 7;
      out.push({ Vb: v, pH: p });
    }
    return out;
  }, [Ca, Va, Cb]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="C_acid" value={Ca} set={setCa} min={0.01} max={1} step={0.01} unit="M" />
        <Slider label="V_acid" value={Va} set={setVa} min={5} max={50} step={1} unit="mL" />
        <Slider label="C_base" value={Cb} set={setCb} min={0.01} max={1} step={0.01} unit="M" />
        <Slider label="V_base added" value={Vb} set={setVb} min={0} max={50} step={0.5} unit="mL" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="V_eq (equivalence)" value={fmtSci(Veq, 2) + ' mL'} />
        <Stat label="pH" value={fmtSci(pH, 2)} />
        <Stat label="at eq" value="pH = 7 (SA–SB)" />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="Vb" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'V_base (mL)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis domain={[0, 14]} stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'pH', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <ReferenceLine x={Veq} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'V_eq', fontSize: 10 }} />
            <ReferenceLine x={Vb} stroke="#22d3ee" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="pH" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status="passed" note="Steep rise at V_eq marks the endpoint. Phenolphthalein changes ~pH 8.2." />
    </div>
  );
}

function Chromatography() {
  const [tR1, setTR1] = useState(5.0);
  const [tR2, setTR2] = useState(7.0);
  const [w1, setW1] = useState(0.4);
  const [w2, setW2] = useState(0.5);
  const Rs = (2 * (tR2 - tR1)) / (w1 + w2);
  const N = useMemo(() => 16 * Math.pow(tR2 / w2, 2), [tR2, w2]);
  const data = useMemo(() => {
    const out = [];
    for (let t = 0; t <= 12; t += 0.05) {
      const g1 = Math.exp(-Math.pow((t - tR1) / (w1 / 4), 2) / 2);
      const g2 = Math.exp(-Math.pow((t - tR2) / (w2 / 4), 2) / 2);
      out.push({ t, peak1: g1, peak2: g2, total: g1 + g2 });
    }
    return out;
  }, [tR1, tR2, w1, w2]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="tR₁" value={tR1} set={setTR1} min={1} max={10} step={0.1} unit="min" />
        <Slider label="tR₂" value={tR2} set={setTR2} min={1} max={12} step={0.1} unit="min" />
        <Slider label="w₁ (width)" value={w1} set={setW1} min={0.1} max={2} step={0.05} unit="min" />
        <Slider label="w₂ (width)" value={w2} set={setW2} min={0.1} max={2} step={0.05} unit="min" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Rs (resolution)" value={fmtSci(Rs, 2)} />
        <Stat label="N (plates)" value={fmtSci(N, 0)} />
        <Stat label="baseline sep" value={Rs >= 1.5 ? 'yes' : Rs >= 1 ? 'partial' : 'no'} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 't (min)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'signal', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="total" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={Rs >= 1.5 ? 'passed' : 'warning'} note="Rs ≥ 1.5 = baseline separation. N = 16(tR/w)² — higher plates, sharper peaks." />
    </div>
  );
}

function Gravimetric() {
  const [mSample, setMSample] = useState(0.5);
  const [mPrecip, setMPrecipMass] = useState(0.234);
  const [MAnalyte, setMAnalyte] = useState(55.85);
  const [MPrecip, setMPrecipMw] = useState(159.69);
  const GF = (MAnalyte * 2) / MPrecip;
  const analyteMass = mPrecip * GF;
  const pct = (analyteMass / mSample) * 100;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="sample mass" value={mSample} set={setMSample} min={0.01} max={2} step={0.01} unit="g" />
        <Slider label="precipitate mass" value={mPrecip} set={setMPrecipMass} min={0.01} max={1} step={0.001} unit="g" />
        <Slider label="M_analyte" value={MAnalyte} set={setMAnalyte} min={1} max={200} step={0.01} unit="g/mol" />
        <Slider label="M_precipitate" value={MPrecip} set={setMPrecipMw} min={1} max={400} step={0.01} unit="g/mol" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Gravimetric factor" value={fmtSci(GF, 4)} />
        <Stat label="analyte mass" value={fmtSci(analyteMass, 4) + ' g'} />
        <Stat label="% analyte" value={fmtSci(pct, 2) + ' %'} />
      </div>
      <ValidationBadge status={pct <= 100 ? 'passed' : 'warning'} note="GF = (n·M_analyte)/M_precip. Fe in Fe₂O₃: GF = 2×55.85/159.69 = 0.6994." />
    </div>
  );
}

function Calibration() {
  const [points, setPoints] = useState('1,2\n2,4.1\n3,5.9\n4,8.2\n5,10.1');
  const parsed = useMemo(() => {
    return points.trim().split('\n').map((l) => {
      const [x, y] = l.split(',').map(Number);
      return { x, y };
    }).filter((p) => isFinite(p.x) && isFinite(p.y));
  }, [points]);
  const fit = useMemo(() => {
    const n = parsed.length;
    if (n < 2) return null;
    const sx = parsed.reduce((s, p) => s + p.x, 0);
    const sy = parsed.reduce((s, p) => s + p.y, 0);
    const sxx = parsed.reduce((s, p) => s + p.x * p.x, 0);
    const sxy = parsed.reduce((s, p) => s + p.x * p.y, 0);
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const b = (sy - m * sx) / n;
    const yhat = parsed.map((p) => m * p.x + b);
    const ssRes = parsed.reduce((s, p, i) => s + Math.pow(p.y - yhat[i], 2), 0);
    const ssTot = parsed.reduce((s, p) => s + Math.pow(p.y - sy / n, 2), 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    return { m, b, r2 };
  }, [parsed]);
  const data = useMemo(() => {
    if (!fit) return [];
    const out = [];
    const xs = parsed.map((p) => p.x);
    const min = Math.min(...xs), max = Math.max(...xs);
    for (let x = min; x <= max; x += (max - min) / 50) out.push({ x, fit: fit.m * x + fit.b });
    return out;
  }, [fit, parsed]);
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="mb-1 text-xs text-muted-foreground">Calibration data (x,y per line)</div>
        <textarea value={points} onChange={(e) => setPoints(e.target.value)} rows={5} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-j text-xs" />
      </label>
      {fit && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="slope m" value={fmtSci(fit.m, 4)} />
          <Stat label="intercept b" value={fmtSci(fit.b, 4)} />
          <Stat label="R²" value={fmtSci(fit.r2, 4)} />
        </div>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'x', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'y', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Line type="monotone" dataKey="fit" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={fit && fit.r2 > 0.95 ? 'passed' : 'warning'} note="Least-squares: y = mx + b. R² → 1 means linear detector response." />
    </div>
  );
}

export default function AnalyticalStudio() {
  return (
    <StudioShell title="Analytical Chemistry Studio" subtitle="Titration · chromatography · gravimetry · calibration — quantify with confidence." tabs={TABS} explain={EXPLAIN}>
      {<Titration />}
      {<Chromatography />}
      {<Gravimetric />}
      {<Calibration />}
    </StudioShell>
  );
}