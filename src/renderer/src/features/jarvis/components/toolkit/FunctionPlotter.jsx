import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const compile = (expression) => {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('x', `with (Math) { return (${expression}); }`);
    fn(1);
    return fn;
  } catch {
    return null;
  }
};

export default function FunctionPlotter() {
  const [expression, setExpression] = useState('sin(x) * x / 3');
  const [xMin, setXMin] = useState('-10');
  const [xMax, setXMax] = useState('10');
  const [samples, setSamples] = useState(400);
  const [showDerivative, setShowDerivative] = useState(false);
  const [showPoints, setShowPoints] = useState(true);

  const fn = useMemo(() => compile(expression), [expression]);

  const data = useMemo(() => {
    if (!fn) return null;
    const min = Number(xMin);
    const max = Number(xMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    const count = Math.min(4000, Math.max(40, samples));
    const step = (max - min) / count;
    const points = [];
    for (let i = 0; i <= count; i += 1) {
      const x = min + step * i;
      let y;
      try {
        y = fn(x);
        if (typeof y !== 'number' || !Number.isFinite(y)) y = null;
      } catch {
        y = null;
      }
      points.push({ x, y });
    }
    const values = points.map((p) => p.y).filter((v) => v !== null);
    if (!values.length) return { points, yMin: -1, yMax: 1, min, max, step, roots: [], extrema: [] };
    const sorted = [...values].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length * 0.02);
    const yMin = Math.min(sorted[trim], 0);
    const yMax = Math.max(sorted[sorted.length - 1 - trim], 0);
    const pad = (yMax - yMin) * 0.08 || 1;
    const roots = [];
    const extrema = [];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const current = points[i];
      if (prev.y === null || current.y === null) continue;
      if (prev.y === 0) roots.push(prev.x);
      else if (prev.y * current.y < 0) roots.push(prev.x + (current.x - prev.x) * (Math.abs(prev.y) / (Math.abs(prev.y) + Math.abs(current.y))));
      if (i > 1) {
        const before = points[i - 2];
        if (before.y !== null && (prev.y - before.y) * (current.y - prev.y) < 0) extrema.push({ x: prev.x, y: prev.y });
      }
    }
    return { points, yMin: yMin - pad, yMax: yMax + pad, min, max, step, roots, extrema };
  }, [fn, xMin, xMax, samples]);

  const width = 720;
  const height = 340;
  const padding = 34;

  const path = useMemo(() => {
    if (!data) return { line: '', derivative: '' };
    const toX = (x) => padding + ((x - data.min) / (data.max - data.min)) * (width - padding * 2);
    const toY = (y) => height - padding - ((y - data.yMin) / (data.yMax - data.yMin)) * (height - padding * 2);
    let line = '';
    let pen = false;
    data.points.forEach((point) => {
      if (point.y === null || point.y < data.yMin - 5 || point.y > data.yMax + 5) {
        pen = false;
        return;
      }
      const command = pen ? 'L' : 'M';
      line += `${command}${toX(point.x).toFixed(1)},${toY(point.y).toFixed(1)} `;
      pen = true;
    });
    let derivative = '';
    if (showDerivative) {
      pen = false;
      for (let i = 1; i < data.points.length; i += 1) {
        const a = data.points[i - 1];
        const b = data.points[i];
        if (a.y === null || b.y === null) { pen = false; continue; }
        const slope = (b.y - a.y) / (b.x - a.x || 1);
        const scaled = Math.max(data.yMin, Math.min(data.yMax, slope / 4));
        const command = pen ? 'L' : 'M';
        derivative += `${command}${toX(a.x).toFixed(1)},${toY(scaled).toFixed(1)} `;
        pen = true;
      }
    }
    return { line: line.trim(), derivative: derivative.trim(), toX, toY };
  }, [data, showDerivative]);

  const table = useMemo(() => {
    if (!data) return [];
    const step = (data.max - data.min) / 10;
    return Array.from({ length: 11 }, (_, i) => {
      const x = data.min + step * i;
      let y;
      try { y = fn(x); } catch { y = NaN; }
      return { x, y: Number.isFinite(y) ? y : NaN };
    });
  }, [data, fn]);

  const report = data ? [`f(x) = ${expression}`, `Domain shown: ${xMin} to ${xMax}`, '', ...table.map((row) => `x=${row.x.toFixed(3)}\tf(x)=${Number.isNaN(row.y) ? 'undefined' : row.y.toFixed(5)}`)].join('\n') : '';

  return (
    <ToolShell
      toolId="plotter"
      icon={TrendingUp}
      title="Function Plotter"
      desc="Plot any expression, spot roots and turning points, and pull a table of values — the graph paper you wish the exam had."
      state={{ expression, xMin, xMax, samples, showDerivative, showPoints }}
      onRestore={(restored) => {
        if (typeof restored.expression === 'string') setExpression(restored.expression);
        if (restored.xMin !== undefined) setXMin(String(restored.xMin));
        if (restored.xMax !== undefined) setXMax(String(restored.xMax));
        if (restored.samples) setSamples(Number(restored.samples));
        if (typeof restored.showDerivative === 'boolean') setShowDerivative(restored.showDerivative);
        if (typeof restored.showPoints === 'boolean') setShowPoints(restored.showPoints);
      }}
      exportText={report}
      exportName="function-values.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value=""
          onChange={(value) => setExpression(value)}
          options={[
            { value: 'sin(x) * x / 3', label: 'sin·x' },
            { value: 'x^2 - 4*x + 3', label: 'parabola' },
            { value: 'exp(-x*x/8) * cos(3*x)', label: 'wave packet' },
            { value: 'log(x)', label: 'ln x' },
            { value: 'x^3 - 3*x', label: 'cubic' },
          ]}
        />
        <CopyBtn value={report} label="Copy table" />
      </div>

      <Field label="f(x) =" hint="Use ^ for powers, and any Math function: sin, cos, log, exp, sqrt, abs, atan…">
        <input value={expression} onChange={(e) => setExpression(e.target.value)} className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
      </Field>

      {!fn && <Panel className="border-amber-500/40 text-[11px] text-amber-500">That expression could not be parsed — check the brackets and function names.</Panel>}

      <div className="tk-card tk-depth overflow-hidden rounded-xl border border-border/70 bg-card/40 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          <defs>
            <linearGradient id="plot-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(189 100% 50%)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="hsl(189 100% 50%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {data && (
            <>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <line key={`h${i}`} x1={padding} x2={width - padding} y1={padding + ((height - padding * 2) / 8) * i} y2={padding + ((height - padding * 2) / 8) * i} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.5" />
              ))}
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                <line key={`v${i}`} y1={padding} y2={height - padding} x1={padding + ((width - padding * 2) / 10) * i} x2={padding + ((width - padding * 2) / 10) * i} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.5" />
              ))}
              {data.yMin < 0 && data.yMax > 0 && (
                <line x1={padding} x2={width - padding} y1={path.toY(0)} y2={path.toY(0)} stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.7" />
              )}
              <line x1={path.toX(0) || padding} x2={path.toX(0) || padding} y1={padding} y2={height - padding} stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity={data.min <= 0 && data.max >= 0 ? 0.7 : 0} />
              {path.derivative && <path d={path.derivative} fill="none" stroke="hsl(280 80% 65%)" strokeWidth="1.5" strokeDasharray="4 3" />}
              <path d={path.line} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
              {showPoints && data.roots.slice(0, 12).map((root, index) => (
                <circle key={`root-${index}`} cx={path.toX(root)} cy={path.toY(0)} r="3.5" fill="hsl(var(--background))" stroke="hsl(var(--cyan))" strokeWidth="2" />
              ))}
              {showPoints && data.extrema.slice(0, 8).map((point, index) => (
                <circle key={`ext-${index}`} cx={path.toX(point.x)} cy={path.toY(point.y)} r="2.5" fill="hsl(280 80% 65%)" />
              ))}
              <text x={padding} y={height - 10} fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{data.min.toFixed(1)}</text>
              <text x={width - padding - 26} y={height - 10} fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{data.max.toFixed(1)}</text>
              <text x={6} y={padding + 8} fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{data.yMax.toFixed(1)}</text>
              <text x={6} y={height - padding} fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{data.yMin.toFixed(1)}</text>
            </>
          )}
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="x from">
          <input value={xMin} onChange={(e) => setXMin(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="x to">
          <input value={xMax} onChange={(e) => setXMax(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Resolution · ${samples} points`}>
          <input type="range" min={80} max={2000} step={20} value={samples} onChange={(e) => setSamples(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="space-y-1.5">
          <ToggleRow label="Show roots and turning points" checked={showPoints} onChange={setShowPoints} />
          <ToggleRow label="Overlay numeric derivative" checked={showDerivative} onChange={setShowDerivative} />
        </div>
      </div>

      {data && (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Roots found" value={String(data.roots.length)} mono />
          <Stat label="Turning points" value={String(data.extrema.length)} mono />
          <Stat label="y range" value={`${data.yMin.toFixed(2)} … ${data.yMax.toFixed(2)}`} mono />
          <Stat label="Step" value={data.step.toExponential(2)} mono />
        </div>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Values</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {table.map((row) => (
            <div key={row.x} className="rounded-lg border border-border/50 bg-card/40 px-2 py-1.5 text-center font-mono-j text-[10px]">
              <div className="text-muted-foreground">x={row.x.toFixed(2)}</div>
              <div className="text-cyan-j">{Number.isNaN(row.y) ? '—' : row.y.toFixed(3)}</div>
            </div>
          ))}
        </div>
        {data && data.extrema.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Turning points near{' '}
            {data.extrema.slice(0, 5).map((point) => `x=${point.x.toFixed(2)}`).join(', ')}
            {' '}— the roots are marked where the curve crosses zero.
          </div>
        )}
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Zoom by narrowing the x range rather than adding points — resolution beyond a few hundred samples rarely changes the shape and only slows the
          page down. The dashed purple line is a numeric derivative (f′(x) ≈ Δy/Δx), scaled to fit: where it crosses zero, the blue curve is flat.
        </p>
      </Panel>
    </ToolShell>
  );
}