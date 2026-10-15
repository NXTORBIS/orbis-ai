import { planarPath, sweepSegment } from '@jarvis/components/toolkit/engines/cncGeometry';
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export const MATERIALS={aluminium:{label:'Aluminium 6061',kc:700,mc:0.25},steel:{label:'Mild steel',kc:1500,mc:0.26},stainless:{label:'Stainless 304',kc:2100,mc:0.24},brass:{label:'Brass',kc:800,mc:0.25},plastic:{label:'Engineering plastic',kc:90,mc:0.3}};
export const TOOLPATHS={raster:{label:'Raster (zig-zag)'},contour:{label:'Offset contours'},spiral:{label:'Circular spiral'}};
export const POCKETS={rectangle:{label:'Rectangle'},circle:{label:'Circle'}};

/** A 2.5D cutter-envelope model, not a machine controller or a force-calibrated digital twin. */
export function cncAnalyze(options={}) {
  const stock={width:clamp(Number(options.width)||80,30,160),height:clamp(Number(options.height)||60,30,160),thickness:clamp(Number(options.thickness)||20,5,60)};
  const pocket=POCKETS[options.pocket]?options.pocket:'rectangle', path=TOOLPATHS[options.path]?options.path:'raster';
  if(path==='spiral'&&pocket!=='circle'&&!options.input?.trim())throw new Error('Spiral paths require a circular pocket.');
  const tool=options.tool==='ball'?'ball':'flat',toolDiameter=clamp(Number(options.toolDiameter)||10,2,25),radius=toolDiameter/2;
  const stepover=clamp(Number(options.stepover)||0.45,0.1,0.9)*toolDiameter;
  const depth=clamp(Number(options.depth)||8,0.5,stock.thickness-1),axial=clamp(Number(options.axial)||2,0.5,10);
  const feed=clamp(Number(options.feed)||900,50,6000),spindle=clamp(Number(options.spindle)||9000,500,24000),flutes=Math.round(clamp(Number(options.flutes)||3,1,6));
  const material=MATERIALS[options.material]?options.material:'aluminium';
  let moves=[],passCount=Math.ceil(depth/axial),name=TOOLPATHS[path].label;
  if(passCount>24)throw new Error('Use at most 24 depth levels; increase axial step-down.');
  if(options.input?.trim()) {
    const input=JSON.parse(options.input); moves=Array.isArray(input)?input:input.points;
    if(!Array.isArray(moves)||moves.length<2||moves.length>2000||moves.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw new Error('Provide 2–2000 [x,y,z] points, in mm, with Z ≤ 0 measured from the stock top.');
    if(moves.some(p=>Math.abs(p[0])>stock.width/2-radius||Math.abs(p[1])>stock.height/2-radius||p[2]>0||p[2]<-stock.thickness+1))throw new Error('Keep the full cutter inside the stock and at least 1 mm above its bottom.');
    passCount=1;name='Custom linear toolpath';
  } else {
    const xy=planarPath({pocket,path,width:stock.width,height:stock.height,toolRadius:radius,stepover});
    for(let pass=1;pass<=passCount;pass++) {
      const z=-depth*pass/passCount;
      if(moves.length)moves.push([xy[0][0],xy[0][1],moves.at(-1)[2]]);
      moves.push(...xy.map(([x,y])=>[x,y,z]));
    }
  }
  const cols=120,rows=90,cell=stock.width*stock.height/(cols*rows),height=new Float64Array(cols*rows).fill(stock.thickness);
  const grid={cols,rows,stock,radius,ball:tool==='ball'};
  const frames=[{step:0,values:Array.from(height),removed:0,distance:0}],curve=[];
  const keep=Math.max(1,Math.ceil((moves.length-1)/12));
  let distance=0,airDistance=0,removedTotal=0;
  removedTotal+=sweepSegment(height,moves[0],moves[0],grid);
  for(let i=1;i<moves.length;i++) {
    const a=moves[i-1],b=moves[i],length=Math.hypot(...a.map((v,k)=>v-b[k]));
    const volume=sweepSegment(height,a,b,grid);
    distance+=length;removedTotal+=volume;if(volume<1e-10)airDistance+=length;
    curve.push({move:i,distance,removed:removedTotal});
    if(i%keep===0||i===moves.length-1)frames.push({step:i,values:Array.from(height),removed:removedTotal,distance});
  }
  const chipLoad=feed/(spindle*flutes),cuttingSpeed=Math.PI*toolDiameter*spindle/1000;
  const actualDepth=-Math.min(...moves.map(p=>p[2]));
  const ap=Math.min(axial,actualDepth),kc=MATERIALS[material].kc*Math.max(chipLoad,0.001)**(-MATERIALS[material].mc);
  const force=kc*ap*chipLoad; // N: Kc [N/mm²] × uncut-chip area [mm²]
  const power=force*cuttingSpeed/60000; // kW: N × m/min / 60,000
  const minutes=distance/feed,remaining=Array.from(height),target=stock.thickness-actualDepth;
  const scallop=tool==='ball'?radius-Math.sqrt(Math.max(0,radius*radius-stepover*stepover/4)):0;
  const gcode=['(SIMULATION ONLY - validate with your machine CAM/postprocessor)', 'G21 G90 G17','G0 Z5',`S${spindle} M3`,`G0 X${moves[0][0].toFixed(3)} Y${moves[0][1].toFixed(3)}`,`G1 Z${moves[0][2].toFixed(3)} F${(feed/3).toFixed(0)}`,...moves.slice(1).map(p=>`G1 X${p[0].toFixed(3)} Y${p[1].toFixed(3)} Z${p[2].toFixed(3)} F${feed}`),'G0 Z5','M5','M30'].join('\n');
  return {name,path,pocket,tool,material,stock,toolDiameter,stepover,depth:actualDepth,feed,spindle,cols,rows,cell,target,moves,frames,curve,remaining,passCount,gcode,stats:{totalLength:distance,totalAir:airDistance,airFraction:distance?airDistance/distance:0,cuttingMinutes:minutes,removedTotal,stockVolume:stock.width*stock.height*stock.thickness,chipLoad,cuttingSpeed,kc,force,power,scallop,measuredRate:minutes?removedTotal/minutes:0,analyticRate:stepover*ap*feed}};
}

export function verifyCnc() {
  const checks=[],push=(label,ok,detail)=>checks.push({label,ok,detail});
  const job=cncAnalyze({depth:4,axial:2}),finalVolume=job.remaining.reduce((a,z)=>a+(job.stock.thickness-z)*job.cell,0);
  push('Removal ledger closes against the final height field',Math.abs(finalVolume-job.stats.removedTotal)<1e-6,`${finalVolume.toFixed(3)} vs ${job.stats.removedTotal.toFixed(3)} mm³`);
  push('No cut raises material or penetrates the target floor',job.remaining.every(z=>z>=job.target-1e-9&&z<=job.stock.thickness),'Monotone minimum of cutter envelopes.');
  push('Intermediate stock surfaces only decrease',job.frames.every((f,k)=>k===0||f.values.every((z,i)=>z<=job.frames[k-1].values[i]+1e-9)),`${job.frames.length} snapshots`);
  const fineGrid={cols:400,rows:300,stock:{width:80,height:60,thickness:20},radius:5,ball:false};
  const fineStock=new Float64Array(400*300).fill(20);
  const volume=sweepSegment(fineStock,[-20,0,-2],[-20,0,-2],fineGrid)+sweepSegment(fineStock,[-20,0,-2],[20,0,-2],fineGrid);
  const sweptArea=40*10+Math.PI*25,actual=volume/2;
  push('Refined straight-pass grid converges to analytic capsule area',Math.abs(actual/sweptArea-1)<0.02,`${actual.toFixed(2)} vs ${sweptArea.toFixed(2)} mm² (0.2 mm cells, 2% tolerance)`);
  const grid={cols:160,rows:120,stock:{width:80,height:60,thickness:20},radius:5,ball:true};
  const surface=new Float64Array(160*120).fill(20);
  sweepSegment(surface,[-20,-2,-4],[20,-2,-4],grid);sweepSegment(surface,[-20,2,-4],[20,2,-4],grid);
  const ix=80,iy=59,x=(ix+0.5)*80/160-40,y=(iy+0.5)*60/120-30,d=Math.min(Math.abs(y-2),Math.abs(y+2));
  const expected=16+5-Math.sqrt(25-d*d);
  push('Ball-nose envelope matches the analytic scallop profile',Math.abs(surface[iy*160+ix]-expected)<1e-10,`at x=${x.toFixed(2)}, y=${y.toFixed(2)}: ${expected.toFixed(5)} mm`);
  push('Simulated cutting time equals length / feed',Math.abs(job.stats.cuttingMinutes-job.stats.totalLength/job.feed)<1e-12,`${job.stats.cuttingMinutes.toFixed(4)} min; retract and setup time excluded.`);
  return {checks};
}