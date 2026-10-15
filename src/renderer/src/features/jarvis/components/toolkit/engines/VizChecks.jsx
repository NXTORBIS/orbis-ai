import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel } from '@jarvis/components/toolkit/shared';
import { VerifyPanel } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';

/** Independent numerical checks for one structure engine, computed in a background worker. */
export default function VizChecks({ kind }) {
  const engine = useVizEngine();
  const [checks, setChecks] = useState(null);
  const run = async () => {
    const result = await engine.run({ action: 'verify', kind });
    if (result) setChecks(result.checks);
  };
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Independent numerical checks</h3>
        <Button variant="outline" disabled={engine.busy} onClick={run}>{engine.busy ? 'Checking…' : 'Run checks'}</Button>
      </div>
      {engine.error && <p role="alert" className="text-xs text-destructive">{engine.error}</p>}
      {checks ? <VerifyPanel items={checks} /> : <p className="text-xs text-muted-foreground">Analytic identities, exhaustive enumeration and independent formulations; computed locally in a background worker.</p>}
    </Panel>
  );
}