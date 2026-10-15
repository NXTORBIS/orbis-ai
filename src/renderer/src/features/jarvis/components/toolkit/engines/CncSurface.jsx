import { useMemo } from 'react';
import ProjectionScene from '@jarvis/components/toolkit/engines/ProjectionScene';
export default function CncSurface({result:r,frame}) {
  const scene=useMemo(()=>{
    const dx=r.stock.width/r.cols,dy=r.stock.height/r.rows,step=4,faces=[];
    const p=(x,y)=>[(x+0.5)*dx-r.stock.width/2,frame.values[y*r.cols+x],(y+0.5)*dy-r.stock.height/2];
    for(let y=0;y<r.rows-1;y+=step)for(let x=0;x<r.cols-1;x+=step){const x1=Math.min(r.cols-1,x+step),y1=Math.min(r.rows-1,y+step);faces.push({points:[p(x,y),p(x1,y),p(x1,y1),p(x,y1)]});}
    const w=r.stock.width/2,h=r.stock.height/2,z=r.stock.thickness;
    const lines=[{points:[[-w,0,-h],[w,0,-h],[w,0,h],[-w,0,h],[-w,0,-h]],dashed:true}];
    for(const [x,y] of [[-w,-h],[w,-h],[w,h],[-w,h]])lines.push({points:[[x,0,y],[x,z,y]],dashed:true});
    const moves=r.moves.slice(0,frame.step+1);
    if(moves.length)lines.push({id:'path',points:moves.map(([x,y,depth])=>[x,z+depth+0.2,y])});
    const tip=r.moves[Math.max(0,frame.step)]||r.moves[0];
    return {faces,lines,points:[{id:'tool',label:'Cutter tip',p:[tip[0],frame.step===0?z:z+tip[2],tip[1]],radius:5}]};
  },[r,frame]);
  return <ProjectionScene {...scene} selected="path" label="Evolving CNC stock surface and travelled toolpath"/>;
}