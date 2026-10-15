export default function TensorNetView({result,step}) {
  const pool=new Map(result.tensors.map(t=>[t.id,{...t,position:result.layout[t.id]}]));
  for(let i=0;i<step;i++){
    const merge=result.steps[i],a=pool.get(merge.a),b=pool.get(merge.b);
    pool.delete(merge.a);pool.delete(merge.b);
    pool.set(`${merge.a}+${merge.b}`,{id:`${merge.a}+${merge.b}`,legs:merge.out,elements:merge.elements,position:[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2]});
  }
  const nodes=[...pool.values()],xs=Object.values(result.layout).map(p=>p[0]),ys=Object.values(result.layout).map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const px=p=>100+500*(p[0]-minX)/(maxX-minX||1),py=p=>60+220*(p[1]-minY)/(maxY-minY||1);
  const bonds=Object.keys(result.dims).map(leg=>({leg,owners:nodes.filter(n=>n.legs.includes(leg))}));
  const next=result.steps[step];
  return <svg viewBox="0 0 720 360" className="w-full rounded-xl bg-background/50" role="img" aria-label={`Tensor network after ${step} contractions`}>
    {bonds.map(({leg,owners})=>owners.length===2?<g key={leg}><line x1={px(owners[0].position)} y1={py(owners[0].position)} x2={px(owners[1].position)} y2={py(owners[1].position)} stroke="hsl(var(--cyan) / 0.6)" strokeWidth="2"/><text x={(px(owners[0].position)+px(owners[1].position))/2+4} y={(py(owners[0].position)+py(owners[1].position))/2-5} fontSize="11" fill="hsl(var(--muted-foreground))">{leg}:{result.dims[leg]}</text></g>:owners.length===1?<line key={leg} x1={px(owners[0].position)} y1={py(owners[0].position)} x2={px(owners[0].position)+35} y2={py(owners[0].position)-30} stroke="hsl(var(--foreground))" strokeDasharray="3 3"/>:null)}
    {nodes.map(n=><g key={n.id} transform={`translate(${px(n.position)},${py(n.position)})`}>
      <circle r="24" fill="hsl(var(--card))" stroke={n.id===next?.a||n.id===next?.b?'hsl(var(--foreground))':'hsl(var(--cyan))'} strokeWidth="2"/>
      <text textAnchor="middle" y="4" fontSize="11" fill="hsl(var(--foreground))">{n.id.length>12?'merged':n.id}</text>
      <text textAnchor="middle" y="40" fontSize="10" fill="hsl(var(--muted-foreground))">{n.elements.toLocaleString()} elements</text>
      <title>{n.id} · indices {n.legs.join(', ')||'scalar'} · {n.elements} elements</title>
    </g>)}
  </svg>;
}