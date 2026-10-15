export default function DistributedTraceView({result:r,selected,onSelect}) {
  const rows=[];
  const walk=(s,depth)=>{rows.push({...s,depth});r.spans.filter(c=>c.parent===s.id).sort((a,b)=>a.start-b.start).forEach(c=>walk(c,depth+1));};
  r.spans.filter(s=>!s.parent).sort((a,b)=>a.start-b.start).forEach(s=>walk(s,0));
  const low=Math.min(...r.spans.map(s=>s.start)),high=Math.max(...r.spans.map(s=>s.end)),scale=630/(high-low||1),px=t=>270+(t-low)*scale;
  return <div className="max-h-[30rem] overflow-auto rounded-xl border border-border bg-background/50">
    <svg viewBox={`0 0 940 ${rows.length*30+55}`} className="min-w-[720px] w-full" role="img" aria-label="Distributed span waterfall with request-critical attribution">
      {[0,0.25,0.5,0.75,1].map(f=><g key={f}><line x1={270+630*f} x2={270+630*f} y1="25" y2={rows.length*30+45} stroke="hsl(var(--border))" strokeDasharray="3 4"/><text x={270+630*f} y="18" fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">{(low+f*(high-low)).toFixed(1)} ms</text></g>)}
      {rows.map((s,i)=>{const y=36+i*30,critical=r.path.includes(s.id);return <g key={s.id} role="button" tabIndex="0" aria-label={`${s.service}: ${s.name}, ${s.duration.toFixed(2)} milliseconds`} onClick={()=>onSelect(s.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(s.id);}}}>
        {selected===s.id&&<rect x="0" y={y-5} width="940" height="29" fill="hsl(var(--accent))"/>}
        <text x={10+s.depth*10} y={y+13} fontSize="10" fill="hsl(var(--foreground))">{s.service.slice(0,15)} · {s.name.slice(0,18)}{s.async?' ↗':''}</text>
        <rect x={px(s.start)} y={y} width={Math.max(2,s.duration*scale)} height="19" rx="3" fill={s.status==='error'?'hsl(var(--destructive) / 0.4)':'hsl(var(--cyan) / 0.12)'} stroke={critical?'hsl(var(--cyan))':'hsl(var(--border))'} strokeDasharray={s.async?'4 3':undefined}/>
        {r.segments.filter(t=>t.id===s.id).map((t,k)=><rect key={k} x={px(t.start)} y={y+12} width={Math.max(1,t.duration*scale)} height="5" fill="hsl(var(--cyan))"/>)}
        <title>{s.id} · {s.name} · duration {s.duration.toFixed(3)} ms · exclusive {s.self.toFixed(3)} ms</title>
      </g>;})}
    </svg>
  </div>;
}