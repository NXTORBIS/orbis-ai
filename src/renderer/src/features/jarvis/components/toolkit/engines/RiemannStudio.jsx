import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel, Seg, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import ProjectionScene from '@jarvis/components/toolkit/engines/ProjectionScene';
import RiemannPlane from '@jarvis/components/toolkit/engines/RiemannPlane';
import { FUNCTIONS } from '@jarvis/components/toolkit/engines/riemannCore';

const DEFAULT = { function: 'sqrtz2m1', radial: 8 };

export default function RiemannStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    engine.run({ kind: 'riemann', action: 'analyze', ...state }).then((value) => { if (live) setResult(value); });
    return () => { live = false; };
  }, [state]);

  const restore = (value) => {
    if (value && FUNCTIONS[value.function]) setState({ function: value.function, radial: [4, 6, 8, 12, 16].includes(Number(value.radial)) ? Number(value.radial) : 8 });
  };

  const spec = FUNCTIONS[state.function];
  const branchPoints = result?.located?.located ?? null;

  return (
    <ToolShell
      toolId="riemann-surface"
      icon={GitBranch}
      title="Riemann Surface Explorer"
      desc="Each sheet is the function continued onto its own branch, drawn over a disc of the z-plane on a polar grid. The branch points marked are found by continuing the function around a loop and seeing whether it returns to the sheet it started on — not quoted from a table."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ function: state.function, sheets: result.sheets, branchPoints: result.located, monodromy: result.monodromy }, null, 2) : ''}
      exportName="riemann-surface.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Function" hint={spec ? `${spec.sheets} sheets` : undefined}>
            <select className="w-full rounded-lg border p-2 text-sm" value={state.function} onChange={(event) => setState((current) => ({ ...current, function: event.target.value }))}>
              {Object.entries(FUNCTIONS).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
            </select>
          </Field>
          <Field label="Radial resolution" hint="More rings resolve the seam more finely.">
            <Seg value={state.radial} onChange={(value) => setState((current) => ({ ...current, radial: Number(value) }))} options={[4, 6, 8, 12, 16].map((value) => ({ value, label: String(value) }))} />
          </Field>
          <div className="flex items-end"><Button disabled={engine.busy} onClick={() => setState((current) => ({ ...current }))}>Recalculate</Button></div>
        </div>
        <p className="text-xs text-muted-foreground">Sheets are stacked along the vertical axis; a dashed link marks where the cut edge of one sheet is glued to the next one full turn later. Drag the surface to rotate it.</p>
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Continuing the function onto every sheet' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <Panel className="space-y-4">
          <ProjectionScene faces={result.mesh.faces} lines={result.mesh.lines} label={`Riemann sheets of ${FUNCTIONS[result.name].label}`} />
        </Panel>
      )}

      {result && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold">Branch structure</h3>
            <RiemannPlane branchPoints={branchPoints ?? []} control={FUNCTIONS[result.name].control} monodromy={result.monodromy} controlSheet={result.control} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Sheets drawn" value={String(result.sheets)} />
              <Stat label="Branch points" value={branchPoints ? `${branchPoints.length}` : `${FUNCTIONS[result.name].branchPoints.length}`} mono />
              <Stat label="Control loop" value={`sheet ${result.control}`} mono />
            </div>
          </Panel>
          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold">Continuation around each branch point</h3>
            <div className="space-y-1.5">
              {result.monodromy.map((entry) => (
                <div key={`${entry.point[0]}-${entry.point[1]}`} className="tk-glass-panel flex items-center justify-between rounded-lg px-3 py-1.5 text-xs">
                  <span className="font-mono-j">z = {entry.point.map((value) => value.toFixed(4)).join(' + ')}i</span>
                  <span className="text-cyan-j">returns on sheet {entry.sheet}</span>
                </div>
              ))}
            </div>
            {result.located?.located && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Radicand roots found by Newton, which are where the square root must branch:</p>
                {result.located.located.map((root) => (
                  <div key={`${root[0]}-${root[1]}`} className="font-mono-j text-[11px] text-cyan-j">z = {root[0].toFixed(6)} {root[1] < 0 ? '−' : '+'} {Math.abs(root[1]).toFixed(6)}i</div>
                ))}
              </div>
            )}
            <Hero label="Monodromy" value={result.monodromy.map((entry) => entry.sheet).join(' → ')} sub="sheet reached after one full turn, per branch point" />
          </Panel>
        </div>
      )}

      <VizChecks kind="riemann" />
    </ToolShell>
  );
}