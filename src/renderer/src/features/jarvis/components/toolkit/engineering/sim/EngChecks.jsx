import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Panel } from '@jarvis/components/toolkit/shared';
import { VerifyPanel } from '@jarvis/components/toolkit/engines/EngineUi';

/** Independent numerical checks shipped with an engineering core, run in the browser. */
export default function EngChecks({ verify, note }) {
  const checks = useMemo(() => {
    try { return verify().checks; } catch (error) { return [{ label: 'Checks could not run', ok: false, detail: error.message }]; }
  }, [verify]);
  return (
    <Panel className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Independent numerical checks</h3>
      <VerifyPanel items={checks} note={note} />
    </Panel>
  );
}