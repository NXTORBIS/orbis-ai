import { formatNumber } from '@jarvis/components/toolkit/science50/model';

export default function SweepTable({ sweep, primary, onApply }) {
  return <details className="rounded-xl border border-border/70 bg-card/50 p-3">
    <summary className="cursor-pointer text-xs font-semibold">Explore {sweep.points.length} calculated samples</summary>
    <div className="mt-3 max-h-64 overflow-auto">
      <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="p-2">{sweep.label}</th><th className="p-2">{primary.label} ({primary.unit || 'unitless'})</th><th className="p-2">Apply</th></tr></thead>
        <tbody>{sweep.points.map((point) => <tr key={point.x} className="border-t border-border/50"><td className="p-2 font-mono">{formatNumber(point.x)}</td><td className="p-2 font-mono" title={point.error}>{point.error ? 'Outside model domain' : formatNumber(point.y)}</td><td className="p-2"><button type="button" disabled={!!point.error} className="rounded border border-cyan-j/30 px-2 py-1 text-cyan-j disabled:opacity-30" onClick={() => onApply(point.x)}>Use input</button></td></tr>)}</tbody>
      </table>
    </div>
  </details>;
}