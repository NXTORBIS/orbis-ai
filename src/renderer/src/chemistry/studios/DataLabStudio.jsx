import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { fmtSci } from '../lib/chemistry/units.js';

const TABS = ['Statistics & Fit', 'Linear Regression', 'Error Propagation', 'Outlier Detection'];

const EXPLAIN = {
  name: 'Chemical Data Lab',
  nameMeaning: 'The data lab applies statistical and numerical methods to experimental chemical measurements.',
  whatItIs: 'A studio for analysing experimental data: descriptive statistics, linear regression, error propagation, and outlier detection (Grubbs\' test).',
  chemistry: 'Every measurement carries uncertainty. Statistical tools quantify central tendency, spread, correlation, and the reliability of a calibration.',
  math: [
    { eq: 'x̄ = Σxᵢ/n, s = √(Σ(xᵢ−x̄)²/(n−1))', label: 'mean & sample SD' },
    { eq: 'y = mx + b, m = Cov(x,y)/Var(x)', label: 'linear regression' },
    { eq: 'σ_f² = Σ(∂f/∂xᵢ)² σᵢ²', label: 'error propagation' },
    { eq: 'G = |xᵢ−x̄|/s', label: "Grubbs' statistic" },
  ],
  variables: [
    { sym: 'x̄', desc: 'sample mean', unit: '—' },
    { sym: 's', desc: 'sample standard deviation', unit: '—' },
    { sym: 'm, b', desc: 'slope, intercept', unit: '—' },
    { sym: 'R²', desc: 'coefficient of determination', unit: '—' },
    { sym: 'G', desc: 'Grubbs statistic', unit: '—' },
  ],
  assumptions: ['Normal (Gaussian) error distribution', 'Independent measurements', 'Homoscedastic residuals', 'No systematic bias'],
  limitations: ['Small samples need t-distribution', 'Outliers can distort mean & SD', 'Correlation ≠ causation', 'Grubbs assumes one outlier'],
  applications: ['Method validation', 'Calibration curves', 'QA/QC', 'Experimental reporting'],
};

function Statistics() {
  const [raw, setRaw] = useState('12.1, 12.3, 12.0, 11.9, 12.2, 12.4, 12.1, 11.8, 12.3, 12.0');
  const stats = useMemo(() => {
    const xs = raw.split(/[,\s]+/).map(Number).filter(isFinite);
    if (!xs.length) return null;
    const n = xs.length;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const se = sd / Math.sqrt(n);
    const sorted = [...xs].sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const ci95 = 1.96 * se;
    return { n, mean, sd, se, median, ci95, min: sorted[0], max: sorted[n - 1] };
  }, [raw]);
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="mb-1 text-xs text-muted-foreground">Measurements (comma or space separated)</div>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-j text-xs" />
      </label>
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="n" value={stats.n} />
          <Stat label="mean" value={fmtSci(stats.mean, 4)} />
          <Stat label="median" value={fmtSci(stats.median, 4)} />
          <Stat label="SD (s)" value={fmtSci(stats.sd, 4)} />
          <Stat label="SE" value={fmtSci(stats.se, 4)} />
          <Stat label="95% CI ±" value={fmtSci(stats.ci95, 4)} />
          <Stat label="min" value={fmtSci(stats.min, 4)} />
          <Stat label="max" value={fmtSci(stats.max, 4)} />
        </div>
      )}
      <ValidationBadge status="passed" note="Sample SD uses (n−1) denominator (Bessel). 95% CI ≈ ±1.96·SE for large n." />
    </div>
  );
}

function Regression() {
  const [points, setPoints] = useState('0,0.1\n1,2.05\n2,3.98\n3,6.1\n4,7.95\n5,10.05');
  const parsed = useMemo(() => points.trim().split('\n').map((l) => l.split(',').map(Number)).filter((p) => p.length === 2 && isFinite(p[0]) && isFinite(p[1])), [points]);
  const fit = useMemo(() => {
    const n = parsed.length;
    if (n < 2) return null;
    const sx = parsed.reduce((s, p) => s + p[0], 0);
    const sy = parsed.reduce((s, p) => s + p[1], 0);
    const sxx = parsed.reduce((s, p) => s + p[0] * p[0], 0);
    const sxy = parsed.reduce((s, p) => s + p[0] * p[1], 0);
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const b = (sy - m * sx) / n;
    const yhat = parsed.map((p) => m * p[0] + b);
    const ssRes = parsed.reduce((s, p, i) => s + (p[1] - yhat[i]) ** 2, 0);
    const ssTot = parsed.reduce((s, p) => s + (p[1] - sy / n) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    const sy_x = Math.sqrt(ssRes / (n - 2));
    return { m, b, r2, sy_x };
  }, [parsed]);
  const data = useMemo(() => {
    if (!fit) return [];
    const out = parsed.map((p) => ({ x: p[0], y: p[1], fit: fit.m * p[0] + fit.b }));
    return out;
  }, [fit, parsed]);
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="mb-1 text-xs text-muted-foreground">Data (x,y per line)</div>
        <textarea value={points} onChange={(e) => setPoints(e.target.value)} rows={5} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-j text-xs" />
      </label>
      {fit && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="slope" value={fmtSci(fit.m, 4)} />
          <Stat label="intercept" value={fmtSci(fit.b, 4)} />
          <Stat label="R²" value={fmtSci(fit.r2, 4)} />
          <Stat label="s_y/x" value={fmtSci(fit.sy_x, 4)} />
        </div>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'x', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} label={{ value: 'y', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="y" stroke="#f97316" strokeWidth={0} dot={{ r: 3, fill: '#f97316' }} name="data" />
            <Line type="monotone" dataKey="fit" stroke="#22d3ee" strokeWidth={2} dot={false} name="fit" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ValidationBadge status={fit && fit.r2 > 0.95 ? 'passed' : 'warning'} note="OLS regression. R² near 1 → strong linear relationship." />
    </div>
  );
}

function ErrorProp() {
  const [x, setX] = useState(2.0);
  const [sx, setSx] = useState(0.1);
  const [y, setY] = useState(3.0);
  const [sy, setSy] = useState(0.2);
  const [op, setOp] = useState('add');
  const { val, err } = useMemo(() => {
    let v, e;
    if (op === 'add' || op === 'sub') { v = op === 'add' ? x + y : x - y; e = Math.sqrt(sx * sx + sy * sy); }
    else if (op === 'mul') { v = x * y; e = Math.abs(v) * Math.sqrt((sx / x) ** 2 + (sy / y) ** 2); }
    else if (op === 'div') { v = x / y; e = Math.abs(v) * Math.sqrt((sx / x) ** 2 + (sy / y) ** 2); }
    else { v = x * y; e = Math.abs(v) * Math.sqrt((sx / x) ** 2 + (sy / y) ** 2); }
    return { val: v, err: e };
  }, [x, sx, y, sy, op]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Operation" value={op} set={setOp} options={[{ value: 'add', label: 'x + y' }, { value: 'sub', label: 'x − y' }, { value: 'mul', label: 'x × y' }, { value: 'div', label: 'x / y' }]} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Slider label="x" value={x} set={setX} min={0.1} max={10} step={0.1} unit="" />
        <Slider label="σ_x" value={sx} set={setSx} min={0.01} max={1} step={0.01} unit="" />
        <Slider label="y" value={y} set={setY} min={0.1} max={10} step={0.1} unit="" />
        <Slider label="σ_y" value={sy} set={setSy} min={0.01} max={1} step={0.01} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="result" value={fmtSci(val, 4)} />
        <Stat label="σ (propagated)" value={fmtSci(err, 4)} />
        <Stat label="rel. unc." value={fmtSci(err / Math.abs(val) * 100, 2) + ' %'} />
      </div>
      <ValidationBadge status="passed" note="Add/sub: σ² = σx² + σy². Mul/div: (σ/f)² = (σx/x)² + (σy/y)²." />
    </div>
  );
}

function Outliers() {
  const [raw, setRaw] = useState('10.1, 10.2, 10.0, 10.3, 10.1, 13.5, 10.2, 10.1');
  const G = useMemo(() => {
    const xs = raw.split(/[,\s]+/).map(Number).filter(isFinite);
    if (xs.length < 3) return null;
    const n = xs.length;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const sorted = [...xs].sort((a, b) => Math.abs(b - mean) - Math.abs(a - mean));
    const suspect = sorted[0];
    const gStat = Math.abs(suspect - mean) / sd;
    // Critical values (two-tailed, α=0.05) for n=3..10 (approx)
    const critTable = { 3: 1.155, 4: 1.481, 5: 1.716, 6: 1.887, 7: 2.020, 8: 2.126, 9: 2.215, 10: 2.290 };
    const crit = critTable[n] || (n > 10 ? 2.5 : 1.155);
    return { n, mean, sd, suspect, gStat, crit, isOutlier: gStat > crit };
  }, [raw]);
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="mb-1 text-xs text-muted-foreground">Data (comma separated)</div>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-j text-xs" />
      </label>
      {G && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="n" value={G.n} />
          <Stat label="suspect" value={fmtSci(G.suspect, 3)} />
          <Stat label="G stat" value={fmtSci(G.gStat, 3)} />
          <Stat label="G crit (α=0.05)" value={fmtSci(G.crit, 3)} />
        </div>
      )}
      {G && <ValidationBadge status={G.isOutlier ? 'warning' : 'passed'} note={G.isOutlier ? `Outlier detected: G > G_crit — consider removing ${G.suspect}.` : 'No outlier: G ≤ G_crit.'} />}
    </div>
  );
}

export default function DataLabStudio() {
  return (
    <StudioShell title="Chemical Data Lab" subtitle="Statistics · regression · error propagation · outlier detection — rigorous data analysis." tabs={TABS} explain={EXPLAIN}>
      {<Statistics />}
      {<Regression />}
      {<ErrorProp />}
      {<Outliers />}
    </StudioShell>
  );
}