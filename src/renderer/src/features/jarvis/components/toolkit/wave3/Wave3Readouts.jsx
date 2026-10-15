import { BookmarkPlus, X } from 'lucide-react';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';

export default function Wave3Readouts({ spec, params, result, comparison, hasComparison, onCapture, onClear, onApply }) {
  const difference = comparison?.primary && result.primary ? result.primary.value - comparison.primary.value : null;
  const scenarios = spec.scenarios ?? [];
  const active = scenarios.find((item) => Object.entries(item.input).every(([key, value]) => params[key] === value));
  const caption = comparison?.error ? `Captured setup: ${comparison.error}`
    : difference === null ? 'Capture the current setup, change any input, and every readout shows the difference.'
    : `Captured ${formatNumber(comparison.primary.value)} ${result.primary.unit} · Change ${difference > 0 ? '+' : ''}${formatNumber(difference)} ${result.primary.unit}${comparison.primary.value !== 0 ? ` (${formatNumber((difference / Math.abs(comparison.primary.value)) * 100)}%)` : ''}`;

  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Hero label={result.primary.label} value={formatNumber(result.primary.value)} unit={result.primary.unit} tone={spec.tone} sub={result.status ?? 'Live calculation'} />
      {result.metrics.slice(0, 3).map((item) => <Stat key={item.label} label={item.label} value={`${formatNumber(item.value)}${item.unit ? ` ${item.unit}` : ''}`} mono />)}
    </div>
    {scenarios.length > 0 && <Panel className="!p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold">Quick setups</div>
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((item) => (
            <button key={item.label} type="button" onClick={() => onApply(item)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${active === item ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border text-muted-foreground hover:text-cyan-j'}`}>{item.label}</button>
          ))}
        </div>
      </div>
    </Panel>}
    <Panel className="flex flex-wrap items-center justify-between gap-3 !p-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold">Scenario comparison</div>
        <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCapture} className="flex items-center gap-1.5 rounded-lg border border-cyan-j/40 bg-cyan-j/10 px-3 py-2 text-xs text-cyan-j"><BookmarkPlus className="h-3.5 w-3.5" />{hasComparison ? 'Replace snapshot' : 'Capture snapshot'}</button>
        {hasComparison && <button type="button" onClick={onClear} aria-label="Clear scenario comparison" className="rounded-lg border border-border p-2"><X className="h-4 w-4" /></button>}
      </div>
    </Panel>
    {result.warning && <p role="status" className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3 text-xs leading-relaxed text-muted-foreground">{result.warning}</p>}
  </>;
}