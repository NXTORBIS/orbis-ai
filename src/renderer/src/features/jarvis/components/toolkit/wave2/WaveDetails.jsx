import { Panel } from '@jarvis/components/toolkit/shared';
import { VerifyPanel } from '@jarvis/components/toolkit/engines/EngineUi';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';
import { ShieldCheck } from 'lucide-react';

export default function WaveDetails({ spec, result, checks }) {
  return <>
    <div className="grid gap-4 lg:grid-cols-2"><Panel className="space-y-2"><h3 className="text-sm font-semibold">Complete results</h3>{result.metrics.map(m=><div key={m.label} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs"><span className="text-muted-foreground">{m.label}</span><span className="font-mono text-cyan-j">{formatNumber(m.value)} {m.unit}</span></div>)}</Panel><Panel className="space-y-3"><h3 className="text-sm font-semibold">Equations & model limits</h3><p className="break-words font-mono text-xs leading-relaxed text-cyan-j">{spec.equation}</p><p className="text-xs leading-relaxed text-muted-foreground">{spec.note}</p><p className="text-[11px] text-muted-foreground">Educational calculation, not safety certification or a substitute for applicable design standards.</p></Panel></div>
    <details className="rounded-xl border border-border/70 bg-card/50 p-3"><summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Reference-case verification</summary><div className="mt-3"><VerifyPanel items={checks} note="Fixed reference cases check numerical results; they do not certify a real-world design." /></div></details>
  </>;
}