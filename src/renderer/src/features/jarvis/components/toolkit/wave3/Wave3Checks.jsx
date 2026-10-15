import { ShieldCheck } from 'lucide-react';
import { Panel } from '@jarvis/components/toolkit/shared';
import { VerifyPanel } from '@jarvis/components/toolkit/engines/EngineUi';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';

export default function Wave3Checks({ spec, result, checks }) {
  return <>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-2">
        <h3 className="text-sm font-semibold">Complete results</h3>
        {result.metrics.map((item) => (
          <div key={item.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-mono-j text-cyan-j">{formatNumber(item.value)}{item.unit ? ` ${item.unit}` : ''}</span>
          </div>
        ))}
      </Panel>
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">Equations & model limits</h3>
        <p className="break-words font-mono-j text-xs leading-relaxed text-cyan-j">{spec.equation}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{spec.note}</p>
        <p className="text-[11px] text-muted-foreground">Educational calculation, not a safety certification and not a substitute for the applicable design standard.</p>
      </Panel>
    </div>
    <details className="rounded-xl border border-border/70 bg-card/50 p-3" open>
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Reference-case verification</summary>
      <div className="mt-3"><VerifyPanel items={checks} note={spec.checkNote ?? 'Fixed reference cases check the numerical result; they do not certify a real design.'} /></div>
    </details>
  </>;
}