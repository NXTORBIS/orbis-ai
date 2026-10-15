import { Button } from '@jarvis/components/ui/button';
import { Panel } from '@jarvis/components/toolkit/shared';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';

export default function VisualizerFrame({ work, kind, toolId, icon, title, desc, controls, children }) {
  return <ToolShell toolId={toolId} icon={icon} title={title} desc={desc} state={work.state} onRestore={work.restore} onReset={work.reset} exportText={work.result ? JSON.stringify({ setup:work.state, result:work.result },null,2):''} exportName={`${toolId}.json`} exportMime="application/json">
    <Panel className="space-y-3">
      {controls}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={work.engine.busy} onClick={work.run}>{work.engine.busy?'Calculating…':'Calculate'}</Button>
        {work.engine.busy && <Button variant="outline" onClick={work.engine.cancel}>Cancel</Button>}
        {!work.result && !work.engine.busy && !work.engine.error && <span className="text-xs text-muted-foreground">Calculate to view this setup.</span>}
      </div>
    </Panel>
    <EngineProgress busy={work.engine.busy} phase={work.engine.busy?'Running numerical engine in the background':''} />
    {work.engine.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{work.engine.error}</p>}
    {work.result && children}
    <VizChecks kind={kind} />
  </ToolShell>;
}