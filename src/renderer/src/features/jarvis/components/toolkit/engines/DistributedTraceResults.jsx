import { useState } from 'react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Bars } from '@jarvis/components/toolkit/kit/premium';
import DistributedTraceView from '@jarvis/components/toolkit/engines/DistributedTraceView';
export default function DistributedTraceResults({result:r}) {
  const [selection,setSelection]=useState(r.hotspots[0]);
  const span=r.spansById[selection]||r.spansById[r.rootId],estimate=r.whatIf.find(p=>p.id===span.id)?.halved??r.wall;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label="Request latency" value={`${r.wall.toFixed(2)} ms`} sub={r.label}/>
      <Stat label="Captured work window" value={`${r.endToEnd.toFixed(2)} ms`} sub="Includes detached async work" mono/>
      <Stat label="Spans / services" value={`${r.spans.length} / ${r.services.length}`} mono/>
      <Stat label="Exclusive service work" value={`${r.selfTotal.toFixed(2)} ms`} sub="May exceed wall time due to concurrency" mono/>
    </div>
    <Panel className="space-y-3">
      <p className="text-xs text-muted-foreground">{r.note}</p>
      <p className="text-xs text-muted-foreground">Cyan strips attribute the synchronous request timeline; dashed spans are detached. Click a span to inspect it. For overlapping siblings, latest-finishing waits are attributed; timestamps alone do not prove causality.</p>
      <DistributedTraceView result={r} selected={span.id} onSelect={setSelection}/>
      <h3 className="break-words text-sm font-semibold">{span.service} · {span.name}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Interval" value={`${span.start.toFixed(2)} → ${span.end.toFixed(2)} ms`}/><Stat label="Exclusive time" value={`${span.self.toFixed(2)} ms`}/><Stat label="Critical attribution" value={`${(r.contributions[span.id]||0).toFixed(2)} ms`}/><Stat label="Halve this exclusive work" value={`${estimate.toFixed(2)} ms request`} sub="Estimated, not measured"/></div>
      <p className="text-xs text-muted-foreground">Span {span.id} · parent {span.parent||'root'} · status {span.status||'unspecified'}. What-if preserves branch launch offsets and parent gaps, re-evaluating each fork/join maximum; it cannot model changed workloads, clock skew or missing spans.</p>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">Exclusive work by service</h3><Bars data={r.services.map(s=>({label:s.service,value:s.self}))} suffix=" ms" format={v=>v.toFixed(2)}/></Panel>
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">Repeated query / call families</h3>{r.repeats.length?r.repeats.map((p,i)=><Stat key={i} label={p.name} value={`${p.count} sibling calls`} sub="Pattern hint, not proof of N+1"/>):<p className="text-xs text-muted-foreground">No family of four or more repeated sibling names detected.</p>}<p className="text-xs text-muted-foreground">Export JSON includes all original spans, attributed intervals, service totals and estimated per-span improvements.</p></Panel>
    </div>
  </>;
}