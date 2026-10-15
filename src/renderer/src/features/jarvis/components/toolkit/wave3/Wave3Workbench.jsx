import { useMemo } from 'react';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { useStoredState } from '@jarvis/components/toolkit/kit/hooks';
import { Panel, Seg } from '@jarvis/components/toolkit/shared';
import { normaliseInput } from '@jarvis/components/toolkit/science50/model';
import { normaliseView, buildSeries } from '@jarvis/components/toolkit/wave3/series';
import Wave3Controls from '@jarvis/components/toolkit/wave3/Wave3Controls';
import Wave3Range from '@jarvis/components/toolkit/wave3/Wave3Range';
import Wave3Stage from '@jarvis/components/toolkit/wave3/Wave3Stage';
import Wave3Readouts from '@jarvis/components/toolkit/wave3/Wave3Readouts';
import Wave3Table from '@jarvis/components/toolkit/wave3/Wave3Table';
import Wave3Checks from '@jarvis/components/toolkit/wave3/Wave3Checks';

const TABS = [{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }, { value: 'checks', label: 'Checks' }];

/** The wave-3 studio: live sliders, an interactive plot, quick setups and a comparison snapshot. */
export default function Wave3Workbench({ spec, icon }) {
  const initial = { params: spec.params, baseline: null, view: normaliseView(spec, {}), tab: 'chart' };
  const [saved, setSaved] = useStoredState(`tk:${spec.id}:studio`, initial);
  const params = useMemo(() => normaliseInput(spec, saved?.params), [spec, saved?.params]);
  const baseline = useMemo(() => (saved?.baseline ? normaliseInput(spec, saved.baseline) : null), [spec, saved?.baseline]);
  const view = useMemo(() => normaliseView(spec, saved?.view), [spec, saved?.view]);
  const tab = TABS.some((item) => item.value === saved?.tab) ? saved.tab : 'chart';
  const result = useMemo(() => spec.evaluate(params), [spec, params]);
  const comparison = useMemo(() => (baseline ? spec.evaluate(baseline) : null), [spec, baseline]);
  const series = useMemo(() => (result.error ? null : buildSeries(spec, params, view, baseline)), [spec, params, view, baseline, result.error]);
  const checks = useMemo(() => spec.verify().checks, [spec]);
  const state = { params, baseline, view, tab };
  const write = (patch) => setSaved({ ...state, ...patch });
  const setParams = (next) => write({ params: normaliseInput(spec, next) });
  const restore = (shared) => {
    if (!shared || typeof shared !== 'object') return;
    setSaved({
      params: normaliseInput(spec, shared.params ?? shared),
      baseline: shared.baseline ? normaliseInput(spec, shared.baseline) : null,
      view: normaliseView(spec, shared.view),
      tab: TABS.some((item) => item.value === shared.tab) ? shared.tab : 'chart',
    });
  };

  return (
    <ToolShell
      toolId={spec.id}
      icon={icon}
      title={spec.title}
      desc={spec.desc}
      state={state}
      onRestore={restore}
      onReset={() => setSaved(initial)}
      exportText={result.error ? '' : JSON.stringify({ tool: spec.id, setup: state, result, sweep: series }, null, 2)}
      exportName={`${spec.id}-results.json`}
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Inputs</h3>
          <Seg value={tab} onChange={(next) => write({ tab: next })} options={TABS} />
        </div>
        <Wave3Controls fields={spec.fields} params={params} onChange={setParams} />
      </Panel>

      {result.error
        ? <Panel><p role="alert" className="text-sm text-muted-foreground">{result.error}</p></Panel>
        : <>
          <Wave3Readouts
            spec={spec}
            params={params}
            result={result}
            comparison={comparison}
            hasComparison={!!baseline}
            onCapture={() => write({ baseline: { ...params } })}
            onClear={() => write({ baseline: null })}
            onApply={(scenario) => setParams({ ...spec.params, ...scenario.input })}
          />
          {tab === 'chart' && <Panel className="space-y-3">
            <Wave3Range spec={spec} view={view} series={series} onChange={(next) => write({ view: normaliseView(spec, next) })} />
            {series.error
              ? <p role="alert" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">{series.error}</p>
              : <Wave3Stage
                  series={series}
                  pickValue={series.pickable && view.variable ? params[view.variable] : null}
                  hasComparison={!!baseline}
                  onPick={series.pickable && view.variable ? (value) => setParams({ ...params, [view.variable]: value }) : undefined}
                />}
          </Panel>}
          {tab === 'table' && <Wave3Table spec={spec} series={series} result={result} hasComparison={!!baseline} onApply={(value) => setParams({ ...params, [view.variable]: value })} />}
          {tab === 'checks' && <Wave3Checks spec={spec} result={result} checks={checks} />}
        </>}
    </ToolShell>
  );
}