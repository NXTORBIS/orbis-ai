import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import SimControls from '@jarvis/components/toolkit/engineering/sim/SimControls';
import EngChecks from '@jarvis/components/toolkit/engineering/sim/EngChecks';
import useSimulation from '@jarvis/components/toolkit/engineering/sim/useSimulation';
import LabControls from '@jarvis/components/toolkit/physics/next/LabControls';

export default function LabWorkbench({ sim, title, desc, icon, children }) {
  const [params, setParams] = useState({ ...sim.params });
  const normalise = useCallback((input) => {
    const next = { ...sim.params };
    for (const field of sim.fields) {
      const value = input?.[field.key];
      if (field.options) { if (field.options.some((option) => option.value === value)) next[field.key] = value; }
      else if (typeof value === 'number' && Number.isFinite(value)) next[field.key] = Math.max(field.min, Math.min(field.max, field.integer ? Math.round(value) : value));
    }
    return sim.normalise ? sim.normalise(next) : next;
  }, [sim]);
  const change = useCallback((input) => setParams(normalise(input)), [normalise]);
  const api = useSimulation(sim, params, sim.options);
  const staticView = sim.static || sim.isStatic?.(params);
  const endTime = sim.endTime?.(params);
  useEffect(() => {
    if (staticView || (endTime !== undefined && api.clock >= endTime && api.running && api.direction > 0)) api.setRunning(false);
    // The transport setter writes to a stable live reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticView, endTime, api.clock, api.running, api.direction]);
  const analysis = useMemo(() => sim.analyse(params), [sim, params]);
  const tableText = useMemo(() => JSON.stringify(analysis), [analysis]);
  const exportText = `{"setup":${JSON.stringify(params)},"measurements":${JSON.stringify(api.readings)},"analysis":${tableText}}`;
  return <ToolShell toolId={sim.id} title={title} desc={desc} icon={icon} state={params} onRestore={change} onReset={() => { setParams({ ...sim.params }); api.reset(); }} exportText={exportText} exportName={`${sim.id}-experiment.json`} exportMime="application/json">
    <Panel className="space-y-4">
      <LabControls params={params} fields={sim.fields} onChange={change} />
      {!staticView && <SimControls api={api} unit={sim.unit} />}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{sim.note}</p>
    </Panel>
    {children({ params, r: api.readings, a: analysis, api, onChange: change })}
    <EngChecks verify={sim.verify} note={sim.checkNote} />
  </ToolShell>;
}