import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Spark } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SAMPLE = `1, 12
2, 19
3, 24
4, 31
5, 37
6, 44
7, 49
8, 58
9, 61
10, 70`;

const parseRows = (text) => {
  const rows = [];
  text.split('\n').forEach((line) => {
    const numbers = line.trim().split(/[,\t;|]+|\s{1,}/).map((cell) => Number(cell)).filter((value) => Number.isFinite(value));
    if (numbers.length >= 2) rows.push([numbers[0], numbers[1]]);
  });
  return rows;
};

const solve3 = (matrix, vector) => {
  const m = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k < 4; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
};

export default function RegressionTool() {
  const [raw, setRaw] = useState(SAMPLE);
  const [mode, setMode] = useState('auto');
  const [predictAt, setPredictAt] = useState('12');

  const fit = useMemo(() => {
    const rows = parseRows(raw);
    if (rows.length < 3) return { error: 'Add at least three rows of data — two points always fit a line perfectly and prove nothing.' };

    const n = rows.length;
    const sumX = rows.reduce((sum, row) => sum + row[0], 0);
    const sumY = rows.reduce((sum, row) => sum + row[1], 0);
    const meanX = sumX / n;
    const meanY = sumY / n;
    const sxx = rows.reduce((sum, row) => sum + (row[0] - meanX) ** 2, 0);
    const sxy = rows.reduce((sum, row) => sum + (row[0] - meanX) * (row[1] - meanY), 0);
    const syy = rows.reduce((sum, row) => sum + (row[1] - meanY) ** 2, 0);

    if (sxx === 0) return { error: 'Every x value is the same, so there is no trend to fit. Vary the x values.' };

    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;
    const r = sxy / Math.sqrt(sxx * syy || 1);
    const rSquared = r * r;

    const residuals = rows.map((row) => ({ x: row[0], y: row[1], predicted: intercept + slope * row[0], residual: row[1] - (intercept + slope * row[0]) }));
    const ssRes = residuals.reduce((sum, point) => sum + point.residual ** 2, 0);
    const standardError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    const slopeError = sxx > 0 ? standardError / Math.sqrt(sxx) : 0;

    // Quadratic fit through the normal equations.
    const k = [[n, sumX, rows.reduce((sum, row) => sum + row[0] ** 2, 0)],
      [sumX, rows.reduce((sum, row) => sum + row[0] ** 2, 0), rows.reduce((sum, row) => sum + row[0] ** 3, 0)],
      [rows.reduce((sum, row) => sum + row[0] ** 2, 0), rows.reduce((sum, row) => sum + row[0] ** 3, 0), rows.reduce((sum, row) => sum + row[0] ** 4, 0)]];
    const vector = [sumY, rows.reduce((sum, row) => sum + row[0] * row[1], 0), rows.reduce((sum, row) => sum + row[0] ** 2 * row[1], 0)];
    const quadratic = solve3(k, vector);
    let quadraticFit = null;
    if (quadratic) {
      const [a, b, c] = quadratic;
      const qRes = rows.reduce((sum, row) => sum + (row[1] - (a + b * row[0] + c * row[0] ** 2)) ** 2, 0);
      const qR2 = syy ? 1 - qRes / syy : 0;
      quadraticFit = { a, b, c, rSquared: qR2, residuals: qRes };
    }

    const useQuadratic = mode === 'quadratic' || (mode === 'auto' && quadraticFit && quadraticFit.rSquared > rSquared + 0.05);
    const chosen = useQuadratic ? 'quadratic' : 'linear';
    const x = Number(predictAt);
    const prediction = Number.isFinite(x)
      ? (chosen === 'quadratic'
        ? quadraticFit.a + quadraticFit.b * x + quadraticFit.c * x * x
        : intercept + slope * x)
      : null;
    const predictionStandard = chosen === 'linear' ? standardError : Math.sqrt(sse(rows, quadraticFit) / Math.max(1, n - 3));

    return {
      rows, n, slope, intercept, r, rSquared, residuals, standardError, slopeError, quadraticFit,
      chosen, prediction, predictX: x, predictionStandard,
      equation: chosen === 'quadratic'
        ? `y = ${quadraticFit.a.toFixed(3)} ${quadraticFit.b >= 0 ? '+' : '−'} ${Math.abs(quadraticFit.b).toFixed(3)}x ${quadraticFit.c >= 0 ? '+' : '−'} ${Math.abs(quadraticFit.c).toFixed(3)}x²`
        : `y = ${slope.toFixed(3)}x ${intercept >= 0 ? '+' : '−'} ${Math.abs(intercept).toFixed(3)}`,
      improving: residuals.filter((point) => point.y > point.predicted).length,
      worst: [...residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))[0],
      chart: residuals.map((point) => (chosen === 'quadratic' && quadraticFit
        ? { x: point.x, y: quadraticFit.a + quadraticFit.b * point.x + quadraticFit.c * point.x * point.x }
        : { x: point.x, y: intercept + slope * point.x })),
    };
  }, [raw, mode, predictAt]);

  const report = fit.error ? fit.error : [
    `${fit.n} data points · ${fit.chosen === 'quadratic' ? 'quadratic' : 'linear'} fit`,
    fit.equation,
    `R² = ${fit.rSquared.toFixed(4)} · r = ${'r' in fit ? fit.r.toFixed(4) : ''}`.trim(),
    `Standard error of the estimate: ${fit.standardError.toFixed(3)}`,
    fit.quadraticFit ? `Quadratic alternative: R² = ${fit.quadraticFit.rSquared.toFixed(4)}` : '',
    Number.isFinite(fit.predictX) ? `Prediction at x = ${fit.predictX}: y ≈ ${fit.prediction.toFixed(3)} (± ${(fit.predictionStandard * 2).toFixed(3)} at about 95%)` : '',
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="regression"
      icon={TrendingUp}
      title="Regression & Trend Fit"
      desc="Paste two columns of data, get the line or curve that fits, how much of the variation it explains, and a prediction with its error."
      state={{ raw, mode, predictAt }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.mode) setMode(restored.mode);
        if (restored.predictAt !== undefined) setPredictAt(String(restored.predictAt));
      }}
      exportText={report}
      exportName="regression.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'auto', label: 'Choose the better fit' }, { value: 'linear', label: 'Force line' }, { value: 'quadratic', label: 'Force curve' }]} />
        <CopyBtn value={report} label="Copy results" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <Area label="Data — one x, y pair per line" value={raw} onChange={setRaw} rows={12} mono placeholder={'1, 12\n2, 19\n3, 24'} />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Data as it was read</div>
          <div className="max-h-64 overflow-auto">
            {fit.error ? (
              <p className="text-[11px] text-rose-400">{fit.error}</p>
            ) : (
              <table className="w-full border-collapse text-left font-mono-j text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="border-b border-border/50 px-2 py-1">x</th>
                    <th className="border-b border-border/50 px-2 py-1">y</th>
                    <th className="border-b border-border/50 px-2 py-1">fitted</th>
                    <th className="border-b border-border/50 px-2 py-1">residual</th>
                  </tr>
                </thead>
                <tbody>
                  {fit.rows.map((row, index) => (
                    <tr key={index} className="border-b border-border/30">
                      <td className="px-2 py-1 text-muted-foreground">{row[0]}</td>
                      <td className="px-2 py-1">{row[1]}</td>
                      <td className="px-2 py-1 text-cyan-j">{fit.residuals[index].predicted.toFixed(2)}</td>
                      <td className={`px-2 py-1 ${Math.abs(fit.residuals[index].residual) > fit.standardError * 2 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                        {fit.residuals[index].residual.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>

      {!fit.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={fit.rSquared > 0.9 ? 'emerald' : fit.rSquared > 0.7 ? 'amber' : 'rose'}
              label="Goodness of fit"
              value={fit.rSquared.toFixed(3)}
              unit="R²"
              sub={`${(fit.rSquared * 100).toFixed(1)}% of the variation in y is explained by ${fit.chosen === 'quadratic' ? 'the curve' : 'the line'}`}
            />
            <Panel className="!p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">The equation</div>
              <div className="mt-1 font-mono-j text-lg text-cyan-j">{fit.equation}</div>
              <div className="mt-2 h-10">
                <Spark data={fit.residuals.map((point) => point.y)} />
              </div>
              <div className="text-[10px] text-muted-foreground">y values in order</div>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Data and the fitted line</div>
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card/40 p-3">
              <svg viewBox="0 0 520 240" className="h-56 w-full">
                {(() => {
                  const xs = fit.rows.map((row) => row[0]);
                  const ys = fit.rows.map((row) => row[1]);
                  const minX = Math.min(...xs);
                  const maxX = Math.max(...xs);
                  const minY = Math.min(...ys, ...fit.chart.map((point) => point.y));
                  const maxY = Math.max(...ys, ...fit.chart.map((point) => point.y));
                  const padX = (maxX - minX) * 0.06 || 1;
                  const padY = (maxY - minY) * 0.12 || 1;
                  const px = (x) => 40 + ((x - (minX - padX)) / ((maxX + padX) - (minX - padX))) * 460;
                  const py = (y) => 200 - ((y - (minY - padY)) / ((maxY + padY) - (minY - padY))) * 170;
                  const sorted = [...fit.chart].sort((a, b) => a.x - b.x);
                  const line = sorted.map((point, index) => `${index ? 'L' : 'M'}${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`).join(' ');
                  return (
                    <>
                      <line x1="40" y1="200" x2="500" y2="200" stroke="hsl(var(--border))" />
                      <line x1="40" y1="30" x2="40" y2="200" stroke="hsl(var(--border))" />
                      <path d={line} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2" />
                      {fit.rows.map((row, index) => (
                        <g key={index}>
                          {fit.chosen === 'linear' && (
                            <line x1={px(row[0])} y1={py(row[1])} x2={px(row[0])} y2={py(fit.residuals[index].predicted)} stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
                          )}
                          <circle cx={px(row[0])} cy={py(row[1])} r="3.5" fill="#fbbf24" />
                        </g>
                      ))}
                      <text x="46" y="24" fontSize="9" fill="hsl(var(--muted-foreground))">y (max {maxY.toFixed(0)})</text>
                      <text x="470" y="216" fontSize="9" fill="hsl(var(--muted-foreground))">x (max {maxX})</text>
                    </>
                  );
                })()}
              </svg>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Amber dots are your data; the cyan line is the fit. Dashed grey segments are residuals — the vertical distance each point sits from the line,
              which is exactly what least squares minimises.
            </p>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Predict y at x =">
              <input value={predictAt} onChange={(e) => setPredictAt(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
            </Field>
            <div className="self-end rounded-xl border border-cyan-j/40 bg-cyan-j/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Predicted y</div>
              <div className="font-mono-j text-sm text-cyan-j">{Number.isFinite(fit.prediction) ? fit.prediction.toFixed(3) : '—'}</div>
            </div>
            <div className="self-end rounded-xl border border-border/70 bg-card/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rough 95% band</div>
              <div className="font-mono-j text-sm">
                {Number.isFinite(fit.prediction) ? `± ${(fit.predictionStandard * 2).toFixed(2)}` : '—'}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">How much each point misses by</div>
              <Bars
                data={fit.residuals.map((point) => ({ label: String(point.x).slice(0, 6), value: Math.abs(point.residual) }))}
                format={(value) => value.toFixed(2)}
                highlightLast={false}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {fit.worst ? `The worst point is x = ${fit.worst.x}, off by ${Math.abs(fit.worst.residual).toFixed(2)}.` : ''} Points that miss by more
                than about twice the standard error ({fit.standardError.toFixed(2)}) are worth checking — they may be typos or a different kind of data.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Reading the numbers honestly</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Slope {fit.slope.toFixed(3)} ± {fit.slopeError.toFixed(3)}: y changes by this much for each unit of x, and that error is the uncertainty in it.</p>
                <p>· Correlation r = {fit.r.toFixed(3)}. Above 0.7 is strong for real-world data; above 0.95 usually means the data is synthetic or tightly controlled.</p>
                <p>· {fit.quadraticFit ? `A quadratic fits with R² = ${fit.quadraticFit.rSquared.toFixed(3)} against the line's ${fit.rSquared.toFixed(3)}${fit.chosen === 'quadratic' ? ' — the curve is genuinely better here.' : ' — the extra term buys too little to be worth it.'}` : 'There is not enough spread to test a quadratic fit.'}</p>
                <p>· Never predict far outside the range you measured. A straight line fitted from 1–10 says nothing reliable about x = 100.</p>
                <p>· R² says how well the model explains this data, not that x causes y. Two trending series will always look related.</p>
              </div>
              <div className="mt-2">
                <Pills
                  items={[
                    { label: 'Row(s) above fit', value: fit.improving },
                    { label: 'Points', value: fit.n },
                    { label: 'Model', value: fit.chosen },
                  ]}
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Slope" value={fit.slope.toFixed(3)} mono sub={`± ${fit.slopeError.toFixed(3)}`} />
            <Stat label="Intercept" value={fit.intercept.toFixed(3)} mono />
            <Stat label="Correlation r" value={fit.r.toFixed(3)} mono />
            <Stat label="Std error" value={fit.standardError.toFixed(3)} mono sub="typical miss size" />
          </div>
        </>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Data is parsed leniently — commas, tabs or plain spaces all work, and any line without two numbers is ignored, so you can paste straight from a
          spreadsheet. The line is found by least squares (minimising the squared residuals), the quadratic by solving the normal equations for a, b and c,
          and the automatic mode only prefers the curve when it explains at least five percentage points more of the variation.
        </p>
      </Panel>
    </ToolShell>
  );
}

const sse = (rows, quadraticFit) => (quadraticFit
  ? rows.reduce((sum, row) => sum + (row[1] - (quadraticFit.a + quadraticFit.b * row[0] + quadraticFit.c * row[0] ** 2)) ** 2, 0)
  : 0);