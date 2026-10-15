import { Button } from '@jarvis/components/ui/button';
import { Field, Panel } from '@jarvis/components/toolkit/shared';
import { RD_MODELS, RD_PRESETS } from '@jarvis/components/toolkit/engines/reactionDiffusionCore';

export default function RdControls({ config, setConfig, simulation, species, setSpecies }) {
  const choose = preset => setConfig(s => ({ ...s, preset, params: { ...RD_PRESETS[preset].params }, initial: 'preset' }));
  const change = (key, value) => setConfig(s => ({ ...s, params: { ...s.params, [key]: value } }));
  return <Panel className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Field label="Model & initial condition"><select className="w-full rounded-lg border p-2 text-xs" value={config.preset} onChange={e => choose(e.target.value)}>{Object.entries(RD_PRESETS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</select></Field>
    <Field label="Periodic grid"><select className="w-full rounded-lg border p-2 text-xs" value={config.n} onChange={e => setConfig(s => ({ ...s, n: Number(e.target.value) }))}>{[32, 64, 128].map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></Field>
    <Field label="Random seed"><input className="w-full rounded-lg border p-2 text-xs" type="number" min="0" step="1" value={config.seed} onChange={e => setConfig(s => ({ ...s, seed: Number(e.target.value) >>> 0 }))} /></Field>
    <Field label="Field displayed"><select className="w-full rounded-lg border p-2 text-xs" value={species} onChange={e => setSpecies(e.target.value)}><option value="u">u · activator / feed</option><option value="v">v · inhibitor / product</option></select></Field>
  </div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(config.params).map(([key, value]) => <Field key={key} label={key === 'h' ? 'Cell spacing h' : key}><input className="w-full rounded-lg border p-2 font-mono text-xs" type="number" step={key === 'Du' || key === 'Dv' || key === 'h' ? '0.1' : '0.001'} value={value} onChange={e => change(key, Number(e.target.value))} /></Field>)}</div>
    <p className="text-xs text-muted-foreground">{RD_MODELS[RD_PRESETS[config.preset].model].note} Changing the setup resets the field.</p>
    <div className="flex flex-wrap items-center gap-2"><Button disabled={!simulation.frame || !!simulation.error} onClick={simulation.toggle}>{simulation.running ? 'Pause' : 'Run'}</Button><Button variant="outline" disabled={!simulation.frame || simulation.running || !!simulation.error} onClick={simulation.step}>Step</Button><Button variant="outline" onClick={simulation.reset}>Reset field</Button>
      <Button variant="outline" onClick={() => setConfig(s => ({ ...s, initial: s.initial === 'mode' ? 'preset' : 'mode' }))}>{config.initial === 'mode' ? 'Restore preset field' : 'Seed predicted mode'}</Button>
      <label className="text-xs text-muted-foreground">Steps/frame <select className="rounded-lg border p-1" value={simulation.speed} onChange={e => simulation.setSpeed(Number(e.target.value))}>{[5, 20, 60, 120].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
  </Panel>;
}