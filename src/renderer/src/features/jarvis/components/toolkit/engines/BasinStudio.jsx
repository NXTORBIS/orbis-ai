import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Field, Panel, Seg, Stat } from '@jarvis/components/toolkit/shared';
import { Gauge, Hero, Pills } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import BasinCanvas from '@jarvis/components/toolkit/engines/BasinCanvas';
import { POLYNOMIALS } from '@jarvis/components/toolkit/engines/basinCore';

const DEFAULT = { polynomial: 'z3-1', n: 256, boundary: true };

export default function BasinStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const [trail, setTrail] = useState(null);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    setTrail(null);
    engine.run({ kind: 'basin', action: 'analyze', polynomial: state.polynomial, n: state.n }).then((value) => { if (live) setResult(value); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.polynomial, state.n]);

  const pick = async (x, y) => {
    const value = await engine.run({ kind: 'basin', action: 'probe', polynomial: state.polynomial, x, y });
    if (value) setTrail(value);
  };

  const restore = (value) => {
    if (!value || !POLYNOMIALS[value.polynomial]) return;
    setState({ polynomial: value.polynomial, n: [96, 128, 192, 256, 384].includes(Number(value.n)) ? Number(value.n) : 256, boundary: value.boundary !== false });
  };

  return (
    <ToolShell
      toolId="fractal-basins"
      icon={Sparkles}
      title="Fractal Basin Boundary Explorer"
      desc="Newton's method run on every pixel of a grid: which root each point reaches, how many steps it took, and where the basins meet. The boundary is measured with box counting and the convergence order is fitted from the iteration history, so the fractality is a measurement rather than a claim."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ polynomial: result.name, grid: result.n, roots: result.roots, areas: result.areas, dimension: result.dimension, meanSteps: result.meanSteps, order: result.order, scaleCounts: result.scaleCounts }, null, 2) : ''}
      exportName="basins.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Polynomial">
            <select className="w-full rounded-lg border p-2 text-sm" value={state.polynomial} onChange={(event) => setState((current) => ({ ...current, polynomial: event.target.value }))}>
              {Object.entries(POLYNOMIALS).map(([key, spec]) => <option key={key} value={key}>{spec.label}</option>)}
            </select>
          </Field>
          <Field label="Grid">
            <Seg value={state.n} onChange={(value) => setState((current) => ({ ...current, n: Number(value) }))} options={[96, 128, 192, 256, 384].map((value) => ({ value, label: `${value}²` }))} />
          </Field>
          <Field label="Boundary highlights">
            <Seg value={state.boundary ? 'on' : 'off'} onChange={(value) => setState((current) => ({ ...current, boundary: value === 'on' }))} options={[{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }]} />
          </Field>
        </div>
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Running Newton on every pixel' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Boundary dimension" value={result.dimension.toFixed(3)} sub="box counting, this grid" />
            <Stat label="Convergence order" value={result.order.toFixed(3)} sub="fitted from the iterates" mono />
            <Stat label="Mean steps" value={result.meanSteps.toFixed(2)} sub="Newton iterations per pixel" mono />
            <Stat label="Boundary share" value={`${(result.boundaryFraction * 100).toFixed(2)}%`} sub={`${result.unresolved} pixels unresolved`} mono />
          </div>
          <Panel className="space-y-4">
            <h3 className="text-sm font-semibold">Basins of attraction — {result.label}</h3>
            <BasinCanvas result={result} showBoundary={state.boundary} trail={trail?.trail ?? null} onPick={pick} />
            {trail && (
              <Pills items={[
                { label: 'iterates', value: trail.steps },
                { label: 'reached root', value: trail.rootIndex >= 0 ? `#${trail.rootIndex + 1}` : 'not within tolerance' },
                { label: 'final residual', value: trail.trail.length ? trail.trail[trail.trail.length - 1].residual.toExponential(2) : '—' },
              ]} />
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Basin areas</h3>
              <div className="space-y-1.5">
                {result.roots.map((root, index) => (
                  <div key={`${root[0]}-${root[1]}`} className="tk-glass-panel flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-mono-j">z = {root[0].toFixed(5)} {root[1] < 0 ? '−' : '+'} {Math.abs(root[1]).toFixed(5)}i</span>
                    <span className="font-mono-j text-cyan-j">{(result.areas[index] * 100).toFixed(3)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">The areas are exact pixel counts, so they sum to the whole domain. Newton converges quadratically: the measured order near the roots is {result.order.toFixed(2)}, which is why the boundaries are this sharp.</p>
            </Panel>
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Box counting across scales</h3>
              <Gauge value={result.dimension} min={1} max={2} label="Boundary dimension" caption="1 = a curve, 2 = fills the plane" bands={[{ min: 1, max: 1.2, label: 'nearly smooth', stroke: 'hsl(160 84% 52%)' }, { min: 1.2, max: 1.6, label: 'fractal', stroke: 'hsl(var(--cyan))' }, { min: 1.6, max: 2, label: 'space filling', stroke: 'hsl(265 85% 68%)' }]} />
              <div className="space-y-1">
                {result.scaleCounts.map((count, index) => (
                  <div key={`${count}-${index}`} className="flex items-center justify-between font-mono-j text-[11px] text-muted-foreground">
                    <span>box size {2 ** index}</span>
                    <span className="text-foreground">{count} boxes</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}

      <VizChecks kind="basin" />
    </ToolShell>
  );
}