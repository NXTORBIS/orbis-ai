import { useEffect, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useScienceEngine from '@jarvis/components/toolkit/engines/useScienceEngine';
import ScienceChecks from '@jarvis/components/toolkit/engines/ScienceChecks';
import BrillouinResults from '@jarvis/components/toolkit/engines/BrillouinResults';
import { LATTICES } from '@jarvis/components/toolkit/engines/brillouinCore';

export default function BrillouinStudio() {
  const [state, setState] = useState({ lattice: 'fcc', model: 'tight-binding', t: 1, a: 3 }), [result, setResult] = useState(null), engine = useScienceEngine();
  useEffect(() => { let live = true; setResult(null); engine.run({ kind: 'brillouin', action: 'analyze', ...state }).then(value => { if (live) setResult(value); }); return () => { live = false; }; }, [state]);
  const change = (field, value) => setState(s => ({ ...s, [field]: value }));
  const choose = lattice => setState(s => ({ ...s, lattice, model: lattice === 'graphene' ? 'graphene' : 'tight-binding', t: lattice === 'graphene' ? 2.8 : s.t, a: lattice === 'graphene' ? 2.46 : s.a }));
  const restore = value => { if (LATTICES[value?.lattice] && ['tight-binding', 'empty-lattice', 'graphene'].includes(value.model) && Number(value.t) > 0 && Number(value.a) > 0 && (value.model !== 'graphene' || value.lattice === 'graphene') && (value.lattice !== 'graphene' || value.model !== 'tight-binding')) setState({ lattice: value.lattice, model: value.model, t: Number(value.t), a: Number(value.a) }); };
  return <ToolShell toolId="brillouin-zone" icon={Grid3x3} title="Brillouin Zone Explorer" desc="Intersect reciprocal-lattice half-spaces, rotate the resulting zone, follow high-symmetry band paths and inspect density of states, effective mass or graphene Dirac cones. Idealized lattice models, not ab initio material predictions." state={state} onRestore={restore} onReset={() => setState({ lattice: 'fcc', model: 'tight-binding', t: 1, a: 3 })} exportText={result ? JSON.stringify({ setup: state, ...result }, null, 2) : ''} exportName="brillouin-analysis.json" exportMime="application/json">
    <Panel><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Lattice"><select className="w-full rounded-lg border p-2 text-sm" value={state.lattice} onChange={e => choose(e.target.value)}>{Object.entries(LATTICES).map(([key, lattice]) => <option key={key} value={key}>{lattice.label}</option>)}</select></Field>
      <Field label="Band model"><select className="w-full rounded-lg border p-2 text-sm" value={state.model} onChange={e => change('model', e.target.value)}><option value={state.lattice === 'graphene' ? 'graphene' : 'tight-binding'}>{state.lattice === 'graphene' ? 'Graphene π / π*' : 'Nearest-neighbour tight binding'}</option><option value="empty-lattice">Folded free electron</option></select></Field>
      <Field label="Hopping t (eV)"><input disabled={state.model === 'empty-lattice'} className="w-full rounded-lg border p-2 text-sm disabled:opacity-50" type="number" min="0.01" step="0.1" value={state.t} onChange={e => change('t', Number(e.target.value))} /></Field>
      <Field label="Lattice constant a (Å)"><input className="w-full rounded-lg border p-2 text-sm" type="number" min="0.1" step="0.1" value={state.a} onChange={e => change('a', Number(e.target.value))} /></Field>
    </div><div className="mt-3 flex gap-2"><Button size="sm" disabled={engine.busy} onClick={() => setState(s => ({ ...s }))}>Recalculate</Button>{engine.busy && <Button size="sm" variant="outline" onClick={engine.cancel}>Cancel calculation</Button>}</div></Panel>
    <EngineProgress busy={engine.busy} phase={engine.busy ? 'Constructing the zone, bands and density of states' : ''} />
    {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}
    {result && <BrillouinResults result={result} state={state} />}
    <ScienceChecks kind="brillouin" />
  </ToolShell>;
}