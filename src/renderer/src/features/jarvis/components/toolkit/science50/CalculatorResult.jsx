import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';

export default function CalculatorResult({ spec, result, sweep, params, onChange }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Hero label={result.primary.label} value={formatNumber(result.primary.value)} unit={result.primary.unit} tone={spec.tone} sub={result.status ?? 'Calculated from your current inputs'} />
      {(result.metrics ?? []).slice(0, 3).map(m => <Stat key={m.label} label={m.label} value={`${formatNumber(m.value)} ${m.unit}`} mono />)}
    </div>
    {result.warning && <p role="status" className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3 text-xs leading-relaxed text-muted-foreground">{result.warning}</p>}
    {result.diagram && <Panel className="space-y-2"><h3 className="text-sm font-semibold">{result.diagram.title}</h3><Scene {...result.diagram.scene} /></Panel>}
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">What-if explorer</h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Sweep variable<select aria-label="What-if sweep variable" className="max-w-full rounded-lg border border-input bg-card p-2 text-xs" value={params._sweep} onChange={e => onChange({ ...params, _sweep: e.target.value })}>{spec.fields.filter(f => !f.options).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
      </div>
      <ScientificPlot series={[{ label: result.primary.label, points: sweep.points.filter(point => typeof point.y === 'number') }]} xLabel={sweep.label} yLabel={`${result.primary.label} (${result.primary.unit || 'unitless'})`} height={280} />
      <p className="text-[11px] text-muted-foreground">Every point is recomputed with only the selected input changed. Unsupported input combinations are omitted; expand the sample table to inspect and apply a value.</p>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-2"><h3 className="text-sm font-semibold">All calculated values</h3>{(result.metrics ?? []).map(m => <div key={m.label} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-xs"><span className="text-muted-foreground">{m.label}</span><span className="font-mono text-cyan-j">{formatNumber(m.value)} {m.unit}</span></div>)}</Panel>
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">Equations & assumptions</h3><p className="break-words font-mono text-xs leading-relaxed text-cyan-j">{spec.equation}</p><p className="text-xs leading-relaxed text-muted-foreground">{spec.note}</p><p className="text-[11px] text-muted-foreground">Educational engineering calculation; verify material properties, operating conditions and applicable design codes before real-world use.</p></Panel>
    </div>
  </>;
}