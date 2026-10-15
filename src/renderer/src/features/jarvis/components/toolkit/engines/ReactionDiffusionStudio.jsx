import { useState } from 'react';
import { Waves } from 'lucide-react';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import ScienceChecks from '@jarvis/components/toolkit/engines/ScienceChecks';
import RdControls from '@jarvis/components/toolkit/engines/RdControls';
import RdResults from '@jarvis/components/toolkit/engines/RdResults';
import RdGrowthCheck from '@jarvis/components/toolkit/engines/RdGrowthCheck';
import useReactionDiffusion from '@jarvis/components/toolkit/engines/useReactionDiffusion';
import { RD_PRESETS } from '@jarvis/components/toolkit/engines/reactionDiffusionCore';

export default function ReactionDiffusionStudio() {
  const [config, setConfig] = useState({ preset: 'schnakenberg-spots', params: { ...RD_PRESETS['schnakenberg-spots'].params }, n: 64, seed: 12345, initial: 'preset' }), [species, setSpecies] = useState('u');
  const simulation = useReactionDiffusion(config), f = simulation.frame;
  const restore = value => { if (RD_PRESETS[value?.preset] && [32, 64, 128].includes(Number(value.n))) setConfig({ preset: value.preset, params: { ...RD_PRESETS[value.preset].params, ...value.params }, n: Number(value.n), seed: Number(value.seed) >>> 0, initial: value.initial === 'mode' ? 'mode' : 'preset' }); };
  const exportText = f ? JSON.stringify({ setup: config, time: f.t, dt: f.dt, stats: f.stats, stability: f.analysis, spectrum: f.spectrum, history: f.history, u: Array.from(f.u), v: Array.from(f.v) }) : '';
  return <ToolShell toolId="reaction-diffusion" icon={Waves} title="Reaction–Diffusion Lab" desc="Live periodic-grid simulations for Gray–Scott, Schnakenberg, Brusselator and FitzHugh–Nagumo: stimulate the field, inspect stability and spectra, and compare seeded-mode growth with the discrete solver prediction." state={config} onRestore={restore} onReset={() => setConfig({ preset: 'schnakenberg-spots', params: { ...RD_PRESETS['schnakenberg-spots'].params }, n: 64, seed: 12345, initial: 'preset' })} exportText={exportText} exportName="reaction-diffusion-snapshot.json" exportMime="application/json">
    <RdControls config={config} setConfig={setConfig} simulation={simulation} species={species} setSpecies={setSpecies} />
    <EngineProgress busy={simulation.busy} phase={simulation.busy ? 'Initializing the grid and stability analysis' : ''} />
    {simulation.error && <p role="alert" className="text-sm text-destructive">{simulation.error}</p>}
    {f && <RdResults frame={f} species={species} stimulate={simulation.stimulate} />}
    <RdGrowthCheck config={config} />
    <ScienceChecks kind="reaction-diffusion" />
  </ToolShell>;
}