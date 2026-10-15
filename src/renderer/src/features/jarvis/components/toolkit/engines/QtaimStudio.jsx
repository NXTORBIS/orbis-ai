import { useEffect, useState } from 'react';
import { Atom } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useScienceEngine from '@jarvis/components/toolkit/engines/useScienceEngine';
import ScienceChecks from '@jarvis/components/toolkit/engines/ScienceChecks';
import QtaimResults from '@jarvis/components/toolkit/engines/QtaimResults';
import { MOLECULES } from '@jarvis/components/toolkit/engines/qtaimCore';

export default function QtaimStudio() {
  const [state, setState] = useState({ molecule: 'H2O', grid: 32 }), [result, setResult] = useState(null), engine = useScienceEngine();
  useEffect(() => { let live = true; setResult(null); engine.run({ kind: 'qtaim', action: 'analyze', ...state }).then(value => { if (live) setResult(value); }); return () => { live = false; }; }, [state]);
  const restore = value => { if (MOLECULES[value?.molecule] && [20, 32, 40].includes(Number(value.grid))) setState({ molecule: value.molecule, grid: Number(value.grid) }); };
  return <ToolShell toolId="qtaim-topology" icon={Atom} title="QTAIM Molecular Topology" desc="Analytic promolecular density, critical points, gradient bond paths, approximate energy densities and atomic-basin integration. This is an educational density model, not a correlated electronic-structure calculation." state={state} onRestore={restore} onReset={() => setState({ molecule: 'H2O', grid: 32 })} exportText={result ? JSON.stringify(result, null, 2) : ''} exportName="qtaim-analysis.json" exportMime="application/json">
    <Panel className="space-y-3"><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Molecule"><select className="w-full rounded-lg border p-2 text-sm" value={state.molecule} onChange={e => { setResult(null); setState(s => ({ ...s, molecule: e.target.value })); }}>{Object.entries(MOLECULES).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</select></Field>
      <Field label="Basin quadrature" hint="Higher resolution improves charge closure."><select className="w-full rounded-lg border p-2 text-sm" value={state.grid} onChange={e => { setResult(null); setState(s => ({ ...s, grid: Number(e.target.value) })); }}>{[20, 32, 40].map(n => <option key={n} value={n}>{n}³ points</option>)}</select></Field>
      <div className="flex items-end gap-2"><Button disabled={engine.busy} onClick={() => setState(s => ({ ...s }))}>Recalculate</Button>{engine.busy && <Button variant="outline" onClick={engine.cancel}>Cancel</Button>}</div>
    </div><p className="text-xs text-muted-foreground">Coordinates in Å; density and energy readouts in atomic units. Ellipticity describes this spherical-superposition field, not π-bond character.</p></Panel>
    <EngineProgress busy={engine.busy} phase={engine.busy ? 'Tracing topology and integrating basins' : ''} />
    {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}
    {result && <QtaimResults key={`${state.molecule}-${state.grid}`} result={result} />}
    <ScienceChecks kind="qtaim" />
  </ToolShell>;
}