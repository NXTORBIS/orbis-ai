import { useState } from 'react';
import { Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import VisualizerControls from '@jarvis/components/toolkit/engines/VisualizerControls';
import SimControls from './SimControls';
import EngChecks from './EngChecks';
import useSimulation from './useSimulation';

/**
 * The stage every engineering simulator renders inside: parameter fields taken from the
 * core, a transport, the animated readouts and the checks the core ships with.
 */
export default function EngShell({ sim, toolId, icon, title, desc, children }) {
  const [params, setParams] = useState({ ...sim.params });
  const api = useSimulation(sim, params, sim.options);

  const restore = (shared) => {
    if (!shared || typeof shared !== 'object') return;
    setParams(Object.fromEntries(Object.entries(sim.params).map(([key, value]) => [key, typeof shared[key] === typeof value ? shared[key] : value])));
  };

  return (
    <ToolShell
      toolId={toolId}
      icon={icon}
      title={title}
      desc={desc}
      state={params}
      onRestore={restore}
      onReset={() => setParams({ ...sim.params })}
      exportText={api.snapshot ? JSON.stringify({ setup: params, measurements: api.readings }, null, 2) : ''}
      exportName={`${toolId}-measurements.json`}
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <VisualizerControls state={params} onChange={setParams} fields={sim.fields} />
        <SimControls api={api} unit={sim.unit || 's'} digits={sim.digits ?? 2} />
        <p className="text-[11px] text-muted-foreground/80">{sim.note}</p>
      </Panel>
      {children({ snapshot: api.snapshot, params, setParams, readings: api.readings, api })}
      <EngChecks verify={sim.verify} note={sim.checkNote} />
    </ToolShell>
  );
}