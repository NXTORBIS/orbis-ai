import { useCallback, useMemo } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { useStoredState } from '@jarvis/components/toolkit/kit/hooks';
import CalculatorControls from '@jarvis/components/toolkit/science50/CalculatorControls';
import { VerifyPanel } from '@jarvis/components/toolkit/engines/EngineUi';
import CalculatorResult from '@jarvis/components/toolkit/science50/CalculatorResult';
import SweepTable from '@jarvis/components/toolkit/science50/SweepTable';
import { normaliseInput, sweepResult } from '@jarvis/components/toolkit/science50/model';

export default function EngineeringCalculator({ spec, icon }) {
  const [saved, setSaved] = useStoredState(`tk:${spec.id}:setup`, spec.params);
  const params = useMemo(() => normaliseInput(spec, saved), [spec, saved]);
  const change = useCallback(value => setSaved(normaliseInput(spec, value)), [spec, setSaved]);
  const result = useMemo(() => spec.evaluate(params), [spec, params]);
  const sweep = useMemo(() => result.error ? null : sweepResult(spec, params), [spec, params, result.error]);
  const checks = useMemo(() => spec.verify().checks, [spec]);
  const report = useMemo(() => result.error ? '' : JSON.stringify({ tool: spec.title, inputs: params, results: result, sensitivity: sweep, equation: spec.equation, assumptions: spec.note }, null, 2), [spec, params, result, sweep]);
  return <ToolShell toolId={spec.id} title={spec.title} desc={spec.desc} icon={icon} state={params} onRestore={change} onReset={() => change(spec.params)} exportText={report} exportName={`${spec.id}.json`} exportMime="application/json">
    <Panel className="space-y-3"><h3 className="text-sm font-semibold">Your inputs</h3><CalculatorControls params={params} fields={spec.fields} onChange={change} /><p className="text-[11px] text-muted-foreground">Units are shown on every field. Inputs and your selected sweep are remembered locally.</p></Panel>
    {result.error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{result.error}</div> : <>
      <CalculatorResult spec={spec} result={result} sweep={sweep} params={params} onChange={change} />
      <SweepTable sweep={sweep} primary={result.primary} onApply={value => change({ ...params, [sweep.key]: value })} />
    </>}
    <details className="tk-glass-panel rounded-xl p-3"><summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Reference-case checks</summary><div className="mt-3"><VerifyPanel items={checks} note="Fixed reference inputs are checked against known results; these are numerical checks, not engineering certification." /></div></details>
  </ToolShell>;
}