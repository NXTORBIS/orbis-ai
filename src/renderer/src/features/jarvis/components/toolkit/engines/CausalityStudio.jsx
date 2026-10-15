import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Pills } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import CausalityView from '@jarvis/components/toolkit/engines/CausalityView';
import { SCENARIOS } from '@jarvis/components/toolkit/engines/causalityCore';

const DEFAULT = { scenario: 'late-delivery' };

export default function CausalityStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    setSelected(null);
    engine.run({ kind: 'causality', action: 'analyze', ...state }).then((value) => { if (live) setResult(value); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const restore = (value) => { if (value && SCENARIOS[value.scenario]) setState({ scenario: value.scenario }); };

  const event = result && selected != null ? result.events[selected] : null;
  const concurrentWith = result && selected != null ? result.concurrent.filter((pair) => pair.includes(selected)).map((pair) => pair[0] === selected ? pair[1] : pair[0]) : [];

  return (
    <ToolShell
      toolId="event-causality"
      icon={Network}
      title="Distributed Event Causality Visualizer"
      desc="A distributed execution reconstructed as a partial order: vector clocks stamped on every event, then checked against an independent reachability closure over the message graph. Concurrent events stay unordered — the diagram shows what a global timestamp would have wrongly ordered."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ scenario: result.name, events: result.events.map((item) => ({ name: item.name, process: result.procs[item.p], clocks: item.vc })), causalPairs: result.pairs.length, concurrentPairs: result.concurrent.length, totalOrderInversions: result.inversions }, null, 2) : ''}
      exportName="causal-order.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Trace">
            <select className="w-full rounded-lg border p-2 text-sm" value={state.scenario} onChange={(event_) => setState({ scenario: event_.target.value })}>
              {Object.entries(SCENARIOS).map(([key, scenario]) => <option key={key} value={key}>{scenario.label}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Button disabled={engine.busy} onClick={() => setState((current) => ({ ...current }))}>Recalculate</Button></div>
          <p className="text-[11px] text-muted-foreground sm:col-span-1">Only the order the events really constrain is drawn: program order inside each process and the send-to-receive edges.</p>
        </div>
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Stamping clocks and closing the causal graph' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Events" value={result.events.length} sub={`${result.procs.length} processes`} />
            <Stat label="Causal pairs" value={result.pairs.length} sub="ordered by the partial order" mono />
            <Stat label="Concurrent pairs" value={result.concurrent.length} sub="provably unordered" mono />
            <Stat label="Total order errors" value={result.inversions} sub="pairs a timestamp order flips" mono />
          </div>
          <Panel className="space-y-4">
            <h3 className="text-sm font-semibold">Space–time diagram</h3>
            <CausalityView procs={result.procs} events={result.events} closure={result.closure} selectedIndex={selected} onSelect={setSelected} />
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'hsl(var(--foreground))' }} /> selected</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'hsl(var(--cyan))' }} /> causal past</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'hsl(160 84% 52%)' }} /> causal future</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: 'hsl(38 92% 55%)' }} /> concurrent</span>
              <span>dashed violet curve = message</span>
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">{event ? `Event: ${event.name}` : 'Select an event'}</h3>
              {event ? (
                <>
                  <Pills items={[
                    { label: 'process', value: result.procs[event.p] },
                    { label: 'vector clock', value: `[${event.vc.join(', ')}]` },
                    { label: 'kind', value: event.kind },
                    { label: 'causal depth', value: result.layer[event.index] },
                  ]} />
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">Causally after ({(result.closure[event.index] ?? []).length})</div>
                    <div className="font-mono-j text-[11px] text-cyan-j">{(result.closure[event.index] ?? []).map((index) => result.events[index].name).join(', ') || 'nothing'}</div>
                    <div className="text-[11px] text-muted-foreground">Concurrent with ({concurrentWith.length})</div>
                    <div className="font-mono-j text-[11px] text-amber-400">{concurrentWith.map((index) => result.events[index].name).join(', ') || 'nothing'}</div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Click any event to see its vector clock, everything it causally follows and everything it is genuinely simultaneous with.</p>
              )}
            </Panel>
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Why this cannot be a timeline</h3>
              <p className="text-xs text-muted-foreground">Sorting these events by their position inside their own process produces a total order, and that order flips {result.inversions} genuinely causal pair{result.inversions === 1 ? '' : 's'}. Vector clocks avoid the flip by only ever claiming order where a message or program order forces it.</p>
              <div className="space-y-1">
                {result.pairs.slice(0, 8).map((pair) => (
                  <div key={`${pair.from}-${pair.to}`} className="tk-glass-panel flex items-center justify-between rounded-lg px-3 py-1 text-[11px]">
                    <span className="font-mono-j">{result.events[pair.from].name} → {result.events[pair.to].name}</span>
                    <span className={pair.clocks ? 'text-cyan-j' : 'text-amber-400'}>{pair.clocks ? 'clocks agree' : 'agrees only in the closure'}</span>
                  </div>
                ))}
              </div>
              <Stat label="Deepest causal chain" value={`${Math.max(...result.layer) + 1} events`} sub="longest path through the order" mono />
            </Panel>
          </div>
        </>
      )}

      <VizChecks kind="causality" />
    </ToolShell>
  );
}