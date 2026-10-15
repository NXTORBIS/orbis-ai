import { useState } from 'react';
import { Panel, Stat, Field } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import TensorNetView from '@jarvis/components/toolkit/engines/TensorNetView';
export default function TensorNetResults({result:r}) {
  const [position,setPosition]=useState(0),step=Math.min(position,r.steps.length),current=r.steps[step-1];
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label="Multiplications" value={r.cost.toLocaleString()} sub={r.orderLabel}/>
      <Stat label="Peak single intermediate" value={`${(r.peak*8/1024).toFixed(2)} KiB`} sub="Float64; not total resident memory" mono/>
      <Stat label="Order agreement" value={r.agreement.toExponential(2)} sub="Spread in output Frobenius norm" mono/>
      <Stat label={r.scalar!==null?'Scalar result':'Output norm'} value={(r.scalar??r.norm).toPrecision(6)} sub={r.outputLegs.join(' × ')||'All indices summed'} mono/>
    </div>
    <Panel className="space-y-3">
      <p className="text-xs text-muted-foreground">{r.note} Every leg label carries its dimension. Outlined nodes are the next pair to merge; dashed legs are open output indices.</p>
      <Field label={`Contraction ${step} / ${r.steps.length}`}><input aria-label="Contraction step" type="range" className="w-full accent-cyan-j" min="0" max={r.steps.length} value={step} onChange={e=>setPosition(Number(e.target.value))}/></Field>
      <TensorNetView result={r} step={step}/>
      {current&&<div className="grid gap-3 sm:grid-cols-3"><Stat label="Summed indices" value={current.shared.join(', ')||'Outer product'}/><Stat label="This step" value={`${current.cost.toLocaleString()} multiplies`}/><Stat label="Output shape" value={current.out.map(l=>`${l}:${r.dims[l]}`).join(' × ')||'Scalar'}/></div>}
    </Panel>
    <Panel className="space-y-3">
      <h3 className="text-sm font-semibold">Same tensors, different contraction trees</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">Order</th><th className="p-2">Multiplies</th><th className="p-2">Peak elements</th><th className="p-2">Output norm</th></tr></thead><tbody>{r.orders.map(o=><tr key={o.id} className="border-b border-border/50"><td className="p-2">{o.label}</td><td className="p-2 font-mono-j">{o.cost.toLocaleString()}</td><td className="p-2 font-mono-j">{o.peak.toLocaleString()}</td><td className="p-2 font-mono-j">{o.norm.toPrecision(6)}</td></tr>)}</tbody></table></div>
      {r.reference!==null&&<p className="text-xs text-muted-foreground">Independent MPS transfer-matrix norm²: {r.reference.toPrecision(8)}.</p>}
      <p className="text-xs">Output indices: {r.outputLegs.join(', ')||'scalar'} · row-major values</p>
      <pre className="max-h-48 overflow-auto rounded-lg bg-background/60 p-3 text-xs font-mono-j">{JSON.stringify(r.output.slice(0,256),null,2)}{r.output.length>256?'\n… export JSON for the complete tensor.':''}</pre>
    </Panel>
  </>;
}