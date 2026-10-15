import { Download } from 'lucide-react';
import { Panel, downloadBlob } from '@jarvis/components/toolkit/shared';
import WaveSweepControls from '@jarvis/components/toolkit/wave2/WaveSweepControls';
import WaveChart from '@jarvis/components/toolkit/wave2/WaveChart';
import WaveSampleTable from '@jarvis/components/toolkit/wave2/WaveSampleTable';

export default function WavePlot({ spec, params, result, view, curve, hasComparison, onChange, onApply }) {
  const exportCSV=()=>{const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';const rows=[[curve.label,`${result.primary.label} (${result.primary.unit})`,'Captured setup','Model note'],...curve.points.map(p=>[p.x,p.y,p.comparison,p.error??''])];downloadBlob(new Blob(['\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`${spec.id}-sweep.csv`);};
  const valid=curve.points?.some(p=>p.y!==null);
  return <Panel className="min-w-0 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Interactive what-if explorer</h3><p className="mt-1 text-[11px] text-muted-foreground">Change one input across a range; all other inputs stay fixed.</p></div><button type="button" disabled={!valid} onClick={exportCSV} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="h-3.5 w-3.5" />Export CSV</button></div>
    <WaveSweepControls spec={spec} view={view} curve={curve} onChange={onChange} />
    {curve.error?<p role="alert" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">{curve.error}</p>:!valid?<p role="status" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">No valid results in this range. Choose different bounds or another input.</p>:<><WaveChart curve={curve} result={result} params={params} view={view} hasComparison={hasComparison} /><p className="text-center text-[11px] text-muted-foreground">{curve.label} → · {result.primary.label} ({result.primary.unit||'value'})</p>{curve.points.some(p=>p.error)&&<p className="text-[11px] text-muted-foreground">Gaps mark input combinations outside the model. Invalid samples cannot be applied.</p>}<WaveSampleTable curve={curve} unit={result.primary.unit} hasComparison={hasComparison} onApply={onApply} /></>}
  </Panel>;
}