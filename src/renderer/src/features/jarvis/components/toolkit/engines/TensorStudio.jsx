import { useEffect, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Pills } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import TensorFieldView from '@jarvis/components/toolkit/engines/TensorFieldView';
import { FAMILIES } from '@jarvis/components/toolkit/engines/tensorCore';

const DEFAULT = { family: 'node', n: 40 };

export default function TensorStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    setSelected(null);
    engine.run({ kind: 'tensor', action: 'analyze', ...state }).then((value) => { if (live) setResult(value); });
    return () => { live = false; };
  }, [state]);

  const restore = (value) => {
    if (!value || !FAMILIES[value.family]) return;
    setState({ family: value.family, n: [16, 24, 32, 40, 56, 72].includes(Number(value.n)) ? Number(value.n) : 40 });
  };

  const total = result ? result.singularities.reduce((sum, point) => sum + point.index, 0) : 0;

  return (
    <ToolShell
      toolId="tensor-field"
      icon={Grid3x3}
      title="Tensor Field Explorer"
      desc="A symmetric tensor field with its eigenvalues, eigenvectors and frame-independent invariants at every sample. The singularities of the eigenvector direction field are located by measuring the winding index cell by cell, which catches both eigenvalue degeneracies and places where the tensor itself vanishes."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ family: result.name, grid: result.n, singularities: result.singularities, selected }, null, 2) : ''}
      exportName="tensor-field.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Field">
            <select className="w-full rounded-lg border p-2 text-sm" value={state.family} onChange={(event) => setState((current) => ({ ...current, family: event.target.value }))}>
              {Object.entries(FAMILIES).map(([key, family]) => <option key={key} value={key}>{family.label}</option>)}
            </select>
          </Field>
          <Field label={`Grid · ${state.n}²`}>
            <input className="w-full accent-cyan-j" type="range" min="16" max="72" step="4" value={state.n} onChange={(event) => setState((current) => ({ ...current, n: Number(event.target.value) }))} />
          </Field>
          <div className="flex items-end"><Button disabled={engine.busy} onClick={() => setState((current) => ({ ...current }))}>Recalculate</Button></div>
        </div>
        {result && <p className="text-xs text-muted-foreground">{result.note}. Eigenvalues come from the closed form for a symmetric 2×2 tensor; the eigenvector direction is a line field, so its index is a multiple of one half.</p>}
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Measuring the winding of the direction field' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Singularities" value={result.singularities.length} sub={result.label} />
            <Stat label="Total index" value={total.toFixed(2)} sub="sum of the located points" mono />
            <Stat label="Degenerate samples" value={`${result.cells.filter((cell) => cell.disc < 1e-3).length}`} sub="where the eigenvalues meet" mono />
            <Stat label="Grid" value={`${result.n}²`} sub={`${result.cells.length} samples`} mono />
          </div>
          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold">Eigenvector directions and eigenvalue magnitudes</h3>
            <TensorFieldView cells={result.cells} n={result.n} extent={result.extent} singularities={result.singularities} selected={selected} onSelect={setSelected} />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Singularities of the direction field</h3>
              {result.singularities.length === 0 ? (
                <p className="text-xs text-muted-foreground">None located — the direction field of this tensor is non-singular everywhere on the sampled domain.</p>
              ) : (
                <div className="space-y-1.5">
                  {result.singularities.map((point) => (
                    <div key={`${point.x}-${point.y}`} className="tk-glass-panel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs">
                      <span className="font-mono-j">({point.x.toFixed(4)}, {point.y.toFixed(4)})</span>
                      <span className="font-mono-j text-cyan-j">index {point.index > 0 ? '+' : '−'}{Math.abs(point.index).toFixed(2)}</span>
                      <span className="text-[10px] text-muted-foreground">{point.kind}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Selected sample</h3>
              {selected ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Stat label="λ₁" value={selected.l1.toFixed(5)} mono />
                    <Stat label="λ₂" value={selected.l2.toFixed(5)} mono />
                    <Stat label="trace" value={selected.trace.toFixed(5)} mono />
                    <Stat label="determinant" value={selected.det.toFixed(5)} mono />
                  </div>
                  <Pills items={[
                    { label: 'discriminant', value: selected.disc.toExponential(2) },
                    { label: 'eigenvector angle', value: `${(selected.angle * (180 / Math.PI)).toFixed(2)}°` },
                    { label: 'position', value: `(${selected.x.toFixed(3)}, ${selected.y.toFixed(3)})` },
                  ]} />
                  <p className="text-[11px] text-muted-foreground">Trace and determinant are the two frame-independent scalars of a symmetric 2×2 tensor: they cannot change when the field is re-expressed in a rotated frame, which is why the singularities are located from the direction field instead.</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Choose a sample from the glyph grid to read its eigen-decomposition and invariants.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      <VizChecks kind="tensor" />
    </ToolShell>
  );
}