import { useMemo, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import { ToolHeader, Area, Stat, Panel, CopyBtn } from './shared';

const parse = (text) => text.split(/[\s,;]+/).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));

function quartile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export default function StatisticsCalculator() {
  const [text, setText] = useState('12, 15, 11, 18, 22, 15, 9, 25, 15, 30');

  const stats = useMemo(() => {
    const nums = parse(text);
    if (!nums.length) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const n = nums.length;
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const counts = new Map();
    nums.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    const maxCount = Math.max(...counts.values());
    const modes = maxCount > 1 ? [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v) : [];
    const variance = n > 1 ? nums.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
    const q1 = quartile(sorted, 0.25);
    const q3 = quartile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const outliers = sorted.filter((v) => v < lowFence || v > highFence);
    const buckets = Array.from({ length: 10 }, (_, i) => 0);
    const min = sorted[0];
    const max = sorted[n - 1];
    const width = max - min || 1;
    nums.forEach((v) => { const idx = Math.min(9, Math.floor(((v - min) / width) * 10)); buckets[idx] += 1; });
    return { nums, sorted, n, sum, mean, median, modes, variance, sd: Math.sqrt(variance), min, max, q1, q3, iqr, outliers, buckets, peak: Math.max(...buckets) };
  }, [text]);

  return (
    <div className="space-y-4">
      <ToolHeader icon={ChartColumn} title="Statistics Calculator" desc="Mean, median, mode, spread and outliers from any list of numbers." />
      <Area value={text} onChange={(v) => setText(v)} rows={4} placeholder="Paste numbers separated by commas, spaces or new lines…" />
      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Count" value={String(stats.n)} />
            <Stat label="Sum" value={stats.sum.toLocaleString()} />
            <Stat label="Mean" value={stats.mean.toFixed(3)} />
            <Stat label="Median" value={stats.median.toString()} />
            <Stat label="Mode" value={stats.modes.length ? stats.modes.join(', ') : 'none'} />
            <Stat label="Minimum" value={String(stats.min)} />
            <Stat label="Maximum" value={String(stats.max)} />
            <Stat label="Range" value={String(stats.max - stats.min)} />
            <Stat label="Variance (sample)" value={stats.variance.toFixed(3)} />
            <Stat label="Std deviation" value={stats.sd.toFixed(3)} />
            <Stat label="Q1" value={stats.q1.toString()} />
            <Stat label="Q3" value={stats.q3.toString()} />
            <Stat label="IQR" value={stats.iqr.toString()} />
            <Stat label="Outliers" value={stats.outliers.length ? stats.outliers.join(', ') : 'none'} />
            <Stat label="Std error" value={(stats.sd / Math.sqrt(stats.n)).toFixed(3)} />
            <Stat label="Coeff. of variation" value={stats.mean ? `${((stats.sd / stats.mean) * 100).toFixed(1)}%` : '—'} />
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Distribution (10 equal buckets)</div>
            <div className="flex h-28 items-end gap-1.5">
              {stats.buckets.map((count, i) => (
                <div key={i} className="group flex-1">
                  <div
                    className="rounded-t-md bg-gradient-to-t from-cyan-j/30 to-cyan-j transition-all group-hover:from-cyan-j/60"
                    style={{ height: `${Math.max(4, (count / (stats.peak || 1)) * 100)}%` }}
                    title={`${count} value${count === 1 ? '' : 's'}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{stats.min}</span><span>{stats.max}</span></div>
          </Panel>
          <CopyBtn value={JSON.stringify({ count: stats.n, sum: stats.sum, mean: stats.mean, median: stats.median, mode: stats.modes, variance: stats.variance, sd: stats.sd, q1: stats.q1, q3: stats.q3, outliers: stats.outliers }, null, 2)} label="Copy statistics" />
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter at least one number.</div>
      )}
    </div>
  );
}