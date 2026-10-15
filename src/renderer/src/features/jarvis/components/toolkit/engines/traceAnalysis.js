/** Synchronous nested-span analysis. Parent metadata alone does not encode arbitrary causal dependencies. */
export function measureTrace(raw) {
  if(!Array.isArray(raw)||!raw.length||raw.length>300)throw new Error('Provide 1–300 spans with id, parent, service, name, start and duration (milliseconds).');
  const spans=raw.map(s=>({...s,id:String(s.id??''),parent:s.parent==null?null:String(s.parent),async:s.async===true,end:s.start+s.duration}));
  const byId=new Map(spans.map(s=>[s.id,s]));
  if(byId.size!==spans.length||spans.some(s=>!s.id||typeof s.service!=='string'||typeof s.name!=='string'||!Number.isFinite(s.start)||!Number.isFinite(s.duration)||s.duration<0||s.parent&&!byId.has(s.parent)))throw new Error('IDs must be unique; parents must exist; names, services and finite nonnegative durations are required.');
  for(const s of spans){const seen=new Set([s.id]);let p=s.parent;while(p){if(seen.has(p))throw new Error('Parent relationships contain a cycle.');seen.add(p);p=byId.get(p).parent;}}
  const kids=new Map(spans.map(s=>[s.id,[]]));
  spans.forEach(s=>{if(s.parent)kids.get(s.parent).push(s);});
  for(const s of spans)if(s.parent&&!s.async){const p=byId.get(s.parent);if(s.start<p.start-1e-7||s.end>p.end+1e-7)throw new Error(`Span ${s.id} falls outside its synchronous parent. Mark detached work async: true.`);}
  const groups=new Map();
  for(const s of spans){
    const children=kids.get(s.id).filter(c=>!c.async).sort((a,b)=>a.start-b.start||a.end-b.end),clusters=[];
    for(const c of children){const g=clusters.at(-1);if(g&&c.start<g.end-1e-9){g.end=Math.max(g.end,c.end);g.items.push(c);}else clusters.push({start:c.start,end:c.end,items:[c]});}
    groups.set(s.id,clusters);s.self=s.duration-clusters.reduce((n,g)=>n+g.end-g.start,0);
  }
  const roots=spans.filter(s=>!s.parent),root=roots.sort((a,b)=>b.duration-a.duration)[0];
  if(!root)throw new Error('The trace needs at least one root request.');
  const segments=[];
  const resolve=(s,low,high)=>{
    if(high-low<1e-9)return;
    const children=kids.get(s.id).filter(c=>!c.async&&c.end>low&&c.start<high);
    const ticks=[low,high,...children.flatMap(c=>[Math.max(low,c.start),Math.min(high,c.end)])].sort((a,b)=>a-b);
    for(let i=1;i<ticks.length;i++){
      const start=ticks[i-1],end=ticks[i];if(end-start<1e-9)continue;
      const active=children.filter(c=>c.start<=start+1e-9&&c.end>=end-1e-9).sort((a,b)=>b.end-a.end||a.id.localeCompare(b.id));
      if(active.length)resolve(active[0],start,end);else segments.push({id:s.id,service:s.service,name:s.name,start,end,duration:end-start});
    }
  };
  resolve(root,root.start,root.end);
  const services=new Map();
  for(const s of spans){if(!services.has(s.service))services.set(s.service,{service:s.service,count:0,self:0,errors:0});const v=services.get(s.service);v.count++;v.self+=s.self;if(s.status==='error')v.errors++;}
  const repeats=new Map();for(const s of spans){const key=JSON.stringify([s.parent,s.service,s.name.replace(/\d+/g,'#')]);repeats.set(key,(repeats.get(key)||0)+1);}
  const endToEnd=Math.max(...spans.map(s=>s.end))-Math.min(...spans.map(s=>s.start));
  return {spans,rootId:root.id,wall:root.duration,endToEnd,segments,path:[...new Set(segments.map(s=>s.id))],services:[...services.values()].sort((a,b)=>b.self-a.self),selfTotal:spans.reduce((a,s)=>a+s.self,0),repeats:[...repeats].filter(([,n])=>n>=4).map(([key,count])=>({name:JSON.parse(key)[2],count})),hotspots:[...spans].sort((a,b)=>b.self-a.self).slice(0,12).map(s=>s.id),groups:Object.fromEntries([...groups].map(([id,gs])=>[id,gs.map(g=>({...g,items:g.items.map(s=>s.id)}))]))};
}

/** Fork/join estimate: preserve branch launch offsets and gaps; re-evaluate all max joins. */
export function traceWhatIf(trace,spanId,factor) {
  const byId=new Map(trace.spans.map(s=>[s.id,s]));
  const walk=id=>{
    const s=byId.get(id),own=s.self*(id===spanId?factor:1);
    return own+(trace.groups[id]||[]).reduce((sum,g)=>sum+Math.max(...g.items.map(child=>byId.get(child).start-g.start+walk(child))),0);
  };
  return walk(trace.rootId);
}