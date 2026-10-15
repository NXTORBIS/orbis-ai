import { useId } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend } from 'recharts';

export default function ScientificPlot({ series = [], xLabel, yLabel, ticks = [], reference, height = 230 }) {
  const id = useId();
  if (!series.some(s => s.points?.length)) return <p className="text-xs text-muted-foreground">No samples to display.</p>;
  const data = series[0].points.map((p, i) => ({ x: p.x, ...Object.fromEntries(series.map((s, j) => [`s${j}`, s.points[i]?.y])) }));
  const tickLabel = value => ticks.find(t => Math.abs(t.dist - value) < 1e-7)?.label.replace('G', 'Γ') ?? Number(value).toPrecision(3);
  return <div className="min-w-0 space-y-2">
    <div style={{ height }} aria-label={`${yLabel} versus ${xLabel}`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" />
        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} ticks={ticks.length ? ticks.map(t => t.dist) : undefined} tickFormatter={tickLabel} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
        <YAxis width={55} stroke="hsl(var(--muted-foreground))" tickFormatter={v => Number(v).toPrecision(3)} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
        <Tooltip contentStyle={{ background: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 11 }} labelFormatter={v => `${xLabel}: ${tickLabel(v)}`} formatter={(v, name) => [Number(v).toPrecision(5), name]} />
        {reference != null && <ReferenceLine y={reference} stroke="hsl(var(--foreground))" strokeDasharray="5 5" />}
        {ticks.map((t, i) => <ReferenceLine key={`${id}-${i}`} x={t.dist} stroke="hsl(var(--border))" />)}
        {series.map((s, i) => <Line key={s.label} name={s.label} dataKey={`s${i}`} stroke={['hsl(var(--cyan))', 'hsl(var(--foreground))', 'hsl(var(--muted-foreground))'][i % 3]} dot={false} isAnimationActive={false} strokeWidth={1.8} />)}
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
      </LineChart></ResponsiveContainer>
    </div>
    <p className="text-center font-mono text-[10px] text-muted-foreground">{xLabel} → · {yLabel}</p>
  </div>;
}