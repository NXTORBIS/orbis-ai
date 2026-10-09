import React, { useMemo, useRef } from 'react';
import { LineChart, Line, ScatterChart, Scatter, BarChart, Bar, AreaChart, Area, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Camera } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { downloadFile } from './research';

// Unified scientific plot. types: line | scatter | bar | area | step | histogram
// log: 'log' (both axes) | 'semi-logx' | 'semi-logy' | none
// data: array of points; series: [{ key, label, color }]
export default function SciPlot({ type = 'line', data = [], series = [], xLabel, yLabel, xKey = 'x', log = 'none', height = 260, xDomain, yDomain, exportName = 'plot' }) {
  const wrapRef = useRef(null);
  const logX = log === 'log' || log === 'semi-logx';
  const logY = log === 'log' || log === 'semi-logy';
  const axisProps = { tick: { fontSize: 10 }, stroke: 'hsl(var(--muted-foreground))', type: 'number', domain: xDomain || ['auto', 'auto'], scale: logX ? 'log' : 'linear' };
  const yProps = { tick: { fontSize: 10 }, stroke: 'hsl(var(--muted-foreground))', type: 'number', domain: yDomain || ['auto', 'auto'], scale: logY ? 'log' : 'linear' };

  const exportCSV = () => {
    if (!data.length) return;
    const keys = [xKey, ...series.map((s) => s.key)];
    const rows = [keys.join(','), ...data.map((d) => keys.map((k) => d[k] ?? '').join(','))];
    downloadFile(rows.join('\n'), `${exportName}.csv`, 'text/csv');
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-2" ref={wrapRef} style={{ height }}>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{xLabel || ''} vs {yLabel || ''}{log !== 'none' ? ` · ${log}` : ''}</span>
        <Button size="sm" variant="ghost" onClick={exportCSV} className="h-6 px-2 text-[10px]"><Camera className="size-3" />CSV</Button>
      </div>
      <ResponsiveContainer width="100%" height="88%">
        {type === 'scatter' ? (
          <ScatterChart margin={{ top: 6, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey={xKey} name={xLabel} {...axisProps} label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -8, fontSize: 10 } : undefined} />
            <YAxis dataKey={series[0]?.key} name={yLabel} {...yProps} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 10 } : undefined} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} cursor={{ strokeDasharray: '3 3' }} />
            {series.map((s) => <Scatter key={s.key} data={data} dataKey={s.key} fill={s.color} name={s.label} isAnimationActive={false} />)}
          </ScatterChart>
        ) : type === 'bar' ? (
          <BarChart data={data} margin={{ top: 6, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis {...yProps} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
            {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.color} name={s.label} isAnimationActive={false} />)}
          </BarChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis {...yProps} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
            {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.25} name={s.label} isAnimationActive={false} strokeWidth={1.6} />)}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis {...yProps} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {series.map((s) => <Line key={s.key} type={type === 'step' ? 'step' : 'monotone'} dataKey={s.key} stroke={s.color} dot={false} name={s.label} isAnimationActive={false} strokeWidth={1.6} />)}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}