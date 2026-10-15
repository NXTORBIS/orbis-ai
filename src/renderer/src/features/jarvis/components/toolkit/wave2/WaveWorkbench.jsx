import { useMemo } from 'react';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { useStoredState } from '@jarvis/components/toolkit/kit/hooks';
import { Panel } from '@jarvis/components/toolkit/shared';
import CalculatorControls from '@jarvis/components/toolkit/science50/CalculatorControls';
import { normaliseInput } from '@jarvis/components/toolkit/science50/model';
import { normaliseChart, makeCurve } from '@jarvis/components/toolkit/wave2/math';
import WaveSummary from '@jarvis/components/toolkit/wave2/WaveSummary';
import WavePlot from '@jarvis/components/toolkit/wave2/WavePlot';
import WaveDetails from '@jarvis/components/toolkit/wave2/WaveDetails';

export default function WaveWorkbench({ spec, icon }) {
  const initial={params:spec.params,baseline:null,chart:normaliseChart(spec)};
  const [saved,setSaved]=useStoredState(`tk:${spec.id}:setup`,initial);
  const params=useMemo(()=>normaliseInput(spec,saved?.params),[spec,saved?.params]);
  const baseline=useMemo(()=>saved?.baseline?normaliseInput(spec,saved.baseline):null,[spec,saved?.baseline]);
  const view=useMemo(()=>normaliseChart(spec,saved?.chart??{}),[spec,saved?.chart]);
  const state={params,baseline,chart:view};
  const result=useMemo(()=>spec.evaluate(params),[spec,params]);
  const comparison=useMemo(()=>baseline?spec.evaluate(baseline):null,[spec,baseline]);
  const curve=useMemo(()=>makeCurve(spec,params,view,baseline),[spec,params,view,baseline]);
  const checks=useMemo(()=>spec.verify().checks,[spec]);
  const restore=shared=>setSaved({params:normaliseInput(spec,shared?.params??shared),baseline:shared?.baseline?normaliseInput(spec,shared.baseline):null,chart:normaliseChart(spec,shared?.chart??{})});
  const updateParams=next=>setSaved({...state,params:normaliseInput(spec,next)});
  const exportText=result.error?'':JSON.stringify({tool:spec.id,setup:state,current:result,captured:comparison,sweep:curve},null,2);
  return <ToolShell toolId={spec.id} icon={icon} title={spec.title} desc={spec.desc} state={state} onRestore={restore} onReset={()=>setSaved(initial)} exportText={exportText} exportName={`${spec.id}-results.json`} exportMime="application/json">
    <Panel className="space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">Set up your calculation</h3><span className="text-[11px] text-muted-foreground">Saved automatically on this device</span></div><CalculatorControls fields={spec.fields} params={params} onChange={updateParams} /></Panel>
    {result.error?<Panel><p role="alert" className="text-sm text-muted-foreground">{result.error}</p></Panel>:<><WaveSummary spec={spec} result={result} comparison={comparison} hasComparison={!!baseline} onCapture={()=>setSaved({...state,baseline:{...params}})} onClear={()=>setSaved({...state,baseline:null})} /><WavePlot spec={spec} params={params} result={result} view={view} curve={curve} hasComparison={!!baseline} onChange={chart=>setSaved({...state,chart})} onApply={value=>updateParams({...params,[view.variable]:value})} /><WaveDetails spec={spec} result={result} checks={checks} /></>}
  </ToolShell>;
}