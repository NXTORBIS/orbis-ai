import React, { useState, useMemo } from 'react';
import { BarChart3, Upload, Trash2 } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';

const SAMPLE = `name,age,score
Alice,20,85
Bob,22,72
Carol,19,91
Dave,21,68
Eve,23,88
Frank,20,77
Grace,22,95`;

export default function DataScienceLab() {
  const [csv, setCsv] = useState(SAMPLE);
  const [chartCol, setChartCol] = useState('score');

  const { headers, rows, numericCols, stats } = useMemo(() => {
    const lines = csv.trim().split('\n').filter(Boolean);
    if (!lines.length) return { headers: [], rows: [], numericCols: [], stats: {} };
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()));
    const numericCols = headers.filter((h, i) => rows.every((r) => r[i] !== '' && !isNaN(+r[i])));
    const stats = {};
    numericCols.forEach((col) => {
      const idx = headers.indexOf(col);
      const vals = rows.map((r) => +r[idx]).filter((v) => !isNaN(v));
      if (!vals.length) return;
      const sorted = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      stats[col] = {
        mean: mean.toFixed(2),
        median: sorted[Math.floor(sorted.length / 2)],
        min: Math.min(...vals),
        max: Math.max(...vals),
        std: Math.sqrt(variance).toFixed(2),
        count: vals.length,
      };
    });
    return { headers, rows, numericCols, stats };
  }, [csv]);

  const histData = useMemo(() => {
    if (!numericCols.includes(chartCol)) return [];
    const idx = headers.indexOf(chartCol);
    const vals = rows.map((r) => +r[idx]).filter((v) => !isNaN(v));
    if (!vals.length) return [];
    const min = Math.min(...vals), max = Math.max(...vals);
    const bins = 8;
    const step = (max - min) / bins || 1;
    const counts = Array(bins).fill(0).map((_, i) => ({ range: `${(min + i * step).toFixed(0)}-${(min + (i + 1) * step).toFixed(0)}`, count: 0 }));
    vals.forEach((v) => {
      let bi = Math.floor((v - min) / step);
      if (bi >= bins) bi = bins - 1;
      counts[bi].count++;
    });
    return counts;
  }, [chartCol, rows, headers, numericCols]);

  const scatterData = useMemo(() => {
    if (numericCols.length < 2) return [];
    const xIdx = headers.indexOf(numericCols[0]);
    const yIdx = headers.indexOf(numericCols[1]);
    return rows.map((r) => ({ x: +r[xIdx], y: +r[yIdx] })).filter((p) => !isNaN(p.x) && !isNaN(p.y));
  }, [rows, headers, numericCols]);

  return (
    <LabShell icon={BarChart3} title="Data Science" description="Paste CSV data — get summary statistics, histograms and scatter plots instantly.">
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-3">
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false}
            className="h-64 resize-none rounded-lg border border-border bg-card p-3 font-mono-j text-xs leading-relaxed scrollbar-thin" />
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-xs font-semibold">Statistics</div>
            {numericCols.length === 0 ? <div className="px-3 py-4 text-xs text-muted-foreground">No numeric columns.</div> :
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-b border-border bg-muted/30 text-[9px] text-muted-foreground">
                    <th className="px-2 py-1 text-left">Col</th><th className="px-2 py-1">Mean</th><th className="px-2 py-1">Median</th><th className="px-2 py-1">Min</th><th className="px-2 py-1">Max</th><th className="px-2 py-1">Std</th>
                  </tr></thead>
                  <tbody>
                    {numericCols.map((c) => (
                      <tr key={c} className="border-b border-border/50">
                        <td className="px-2 py-1 font-mono-j text-cyan-j">{c}</td>
                        <td className="px-2 py-1 text-center font-mono-j">{stats[c].mean}</td>
                        <td className="px-2 py-1 text-center font-mono-j">{stats[c].median}</td>
                        <td className="px-2 py-1 text-center font-mono-j">{stats[c].min}</td>
                        <td className="px-2 py-1 text-center font-mono-j">{stats[c].max}</td>
                        <td className="px-2 py-1 text-center font-mono-j">{stats[c].std}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold">Histogram</span>
              <select value={chartCol} onChange={(e) => setChartCol(e.target.value)} className="rounded border border-border bg-background px-2 py-0.5 text-xs">
                {numericCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={histData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 20%)" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} stroke="hsl(215 20% 65%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(215 20% 65%)" />
                <Tooltip contentStyle={{ background: 'hsl(222 40% 7%)', border: '1px solid hsl(222 30% 16%)', fontSize: 11 }} />
                <Bar dataKey="count" fill="hsl(189 100% 50%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {numericCols.length >= 2 && (
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 text-xs font-semibold">Scatter: {numericCols[0]} vs {numericCols[1]}</div>
              <ResponsiveContainer width="100%" height={180}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 20%)" />
                  <XAxis dataKey="x" tick={{ fontSize: 11 }} stroke="hsl(215 20% 65%)" name={numericCols[0]} />
                  <YAxis dataKey="y" tick={{ fontSize: 11 }} stroke="hsl(215 20% 65%)" name={numericCols[1]} />
                  <Tooltip contentStyle={{ background: 'hsl(222 40% 7%)', border: '1px solid hsl(222 30% 16%)', fontSize: 11 }} />
                  <Scatter data={scatterData} fill="hsl(38 100% 50%)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </LabShell>
  );
}