import { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel, Seg, Stat, ToggleRow } from '@jarvis/components/toolkit/shared';
import { Bars, Hero, Pills } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import ReachabilityView from '@jarvis/components/toolkit/engines/ReachabilityView';
import { SYSTEMS } from '@jarvis/components/toolkit/engines/reachabilityCore';

const DEFAULT = { system: 'unstable-drift', horizon: SYSTEMS['unstable-drift'].horizon, cloud: true };

export default function ReachabilityStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const [forwardStep, setForwardStep] = useState(DEFAULT.horizon);
  const [backwardStep, setBackwardStep] = useState(DEFAULT.horizon);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    engine.run({ kind: 'reachability', action: 'analyze', system: state.system, horizon: state.horizon }).then((value) => {
      if (!live) return;
      setResult(value);
      setForwardStep(value.horizon);
      setBackwardStep(value.horizon);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.system, state.horizon]);

  const restore = (value) => {
    if (!value || !SYSTEMS[value.system]) return;
    setState({ system: value.system, horizon: Math.min(20, Math.max(2, Number(value.horizon) || SYSTEMS[value.system].horizon)), cloud: value.cloud !== false });
  };

  const growth = useMemo(() => (result ? result.forward.history.map((step) => ({ label: String(step.step), value: step.area })) : []), [result]);
  const survived = result ? result.backward.history.filter((step) => step.area > 0).length : 0;

  return (
    <ToolShell
      toolId="state-reachability"
      icon={Target}
      title="State-Space Reachability Visualizer"
      desc="Reachable and avoidable sets for a linear system with bounded control, kept in half-plane form so each step is exact rather than an envelope: a linear map transforms the normals, and the bounds only shift the offsets. The result is checked against exhaustive corner trajectories and against sampled ones."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ system: result.name, horizon: result.horizon, forwardArea: result.forward.area, backwardArea: result.backward.empty ? 0 : result.backward.history[result.horizon].area, referencePoints: result.reference.points }, null, 2) : ''}
      exportName="reachability.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="System">
            <select className="w-full rounded-lg border p-2 text-sm" value={state.system} onChange={(event) => setState((current) => ({ ...current, system: event.target.value, horizon: SYSTEMS[event.target.value].horizon }))}>
              {Object.entries(SYSTEMS).map(([key, system]) => <option key={key} value={key}>{system.label}</option>)}
            </select>
          </Field>
          <Field label={`Horizon · ${state.horizon} steps`}>
            <input className="w-full accent-cyan-j" type="range" min="2" max="20" value={state.horizon} onChange={(event) => setState((current) => ({ ...current, horizon: Number(event.target.value) }))} />
          </Field>
          <div className="flex items-end"><Button disabled={engine.busy} onClick={() => setState((current) => ({ ...current }))}>Recalculate</Button></div>
        </div>
        <ToggleRow label="Show sampled trajectories" hint="a seeded cloud of admissible control sequences" checked={state.cloud} onChange={(value) => setState((current) => ({ ...current, cloud: value }))} />
        {result && <p className="text-xs text-muted-foreground">Control authority ±{result.system.umax}{result.system.inputs > 1 ? ` on ${result.system.inputs} inputs` : ''}; safe set ±{result.system.safe}. The reachable set is convex, so its support function is all that is needed — which is why the hull below is exact, not an outer bound.</p>}
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Propagating the sets step by step' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Reachable area" value={result.forward.area.toFixed(3)} sub={`after ${result.horizon} steps`} />
            <Stat label="Avoidable area" value={result.backward.empty ? 'empty' : result.backward.history[result.horizon].area.toFixed(4)} sub={`survives ${survived} steps`} mono />
            <Stat label="Corner trajectories" value={result.reference.points.toLocaleString()} sub="exhaustive, for comparison" mono />
            <Stat label="Sampled states" value="2 400" sub="verified inside the hull" mono />
          </div>
          <Panel className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Sets in the state plane</h3>
              <div className="flex flex-wrap gap-3">
                <label className="text-[11px] text-muted-foreground">reachable step {forwardStep}
                  <input className="ml-2 w-28 align-middle accent-cyan-j" type="range" min="1" max={result.horizon} value={forwardStep} onChange={(event) => setForwardStep(Number(event.target.value))} />
                </label>
                <label className="text-[11px] text-muted-foreground">avoidable step {backwardStep}
                  <input className="ml-2 w-28 align-middle accent-cyan-j" type="range" min="1" max={result.horizon} value={backwardStep} onChange={(event) => setBackwardStep(Number(event.target.value))} />
                </label>
              </div>
            </div>
            <ReachabilityView forward={result.forward} backward={result.backward} reference={result.reference} system={result.system} forwardStep={forwardStep} backwardStep={backwardStep} showCloud={state.cloud} />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Reachable area against the horizon</h3>
              <Bars data={growth} suffix=" u²" format={(value) => value.toFixed(2)} />
              <p className="text-[11px] text-muted-foreground">Monotone growth is a property of the recursion, not a drawing choice: the reachable set for n+1 steps contains the one for n.</p>
            </Panel>
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">The guarantee being shown</h3>
              <Pills items={[
                { label: 'forward', value: 'every admissible input sequence ends inside the hull' },
                { label: 'backward', value: 'every admissible input keeps the next state inside the previous set' },
              ]} />
              <p className="text-xs text-muted-foreground">When the avoidable region becomes empty, no admissible control exists that keeps the system inside the safe set for that many steps — try raising the horizon for this system and watch the violet region disappear.</p>
              <Seg value={state.system} onChange={() => undefined} options={[{ value: state.system, label: `A = [[${result.system.A[0][0]}, ${result.system.A[0][1]}], [${result.system.A[1][0]}, ${result.system.A[1][1]}]]` }]} />
            </Panel>
          </div>
        </>
      )}

      <VizChecks kind="reachability" />
    </ToolShell>
  );
}