import { Download, CornerDownLeft } from 'lucide-react';
import { Panel, downloadBlob } from '@jarvis/components/toolkit/shared';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';
import { tabulate, toCSV } from '@jarvis/components/toolkit/wave3/series';

export default function Wave3Table({ spec, series, result, hasComparison, onApply }) {
  const rows = tabulate(series);
  const exportCSV = () => downloadBlob(
    new Blob([`\uFEFF${toCSV([[series.xLabel, `${series.yLabel} (${series.unit || 'value'})`, 'Captured setup'], ...rows.map((row) => [row.x, row.y, row.comparison])])}`], { type: 'text/csv;charset=utf-8' }),
    `${spec.id}-samples.csv`,
  );

  if (series.error) return <Panel><p role="alert" className="text-xs text-muted-foreground">{series.error}</p></Panel>;

  return <Panel className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">Sampled values</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">{rows.length} of {series.points.filter((item) => item.y !== null).length} plotted points{series.pickable ? ' · apply any row to the inputs' : ''}</p>
      </div>
      <button type="button" disabled={!rows.length} onClick={exportCSV} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="h-3.5 w-3.5" />Export CSV</button>
    </div>
    <div className="tk-glass-panel overflow-x-auto rounded-xl">
      <table className="w-full min-w-[26rem] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border/70">
            <th className="px-3 py-2 font-medium">{series.xLabel}</th>
            <th className="px-3 py-2 font-medium">{series.yLabel} ({series.unit || 'value'})</th>
            {hasComparison && <th className="px-3 py-2 font-medium">Captured</th>}
            {series.pickable && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.x} className="border-b border-border/40 last:border-0 hover:bg-accent/40">
              <td className="px-3 py-1.5 font-mono-j">{formatNumber(row.x)}</td>
              <td className="px-3 py-1.5 font-mono-j text-cyan-j">{formatNumber(row.y)}</td>
              {hasComparison && <td className="px-3 py-1.5 font-mono-j text-violet-400">{typeof row.comparison === 'number' ? formatNumber(row.comparison) : '—'}</td>}
              {series.pickable && <td className="px-3 py-1.5 text-right"><button type="button" onClick={() => onApply(row.x)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-cyan-j"><CornerDownLeft className="h-3 w-3" />Use</button></td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No valid samples in this range.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-[11px] text-muted-foreground">Current result: {formatNumber(result.primary.value)} {result.primary.unit} · {result.primary.label}</p>
  </Panel>;
}