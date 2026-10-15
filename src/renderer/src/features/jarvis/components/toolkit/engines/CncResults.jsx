import { useState } from 'react';
import { Panel, Stat, Field, Seg, downloadBlob } from '@jarvis/components/toolkit/shared';
import { Button } from '@jarvis/components/ui/button';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import CncSurface from '@jarvis/components/toolkit/engines/CncSurface';
import ScalarFieldCanvas from '@jarvis/components/toolkit/engines/ScalarFieldCanvas';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
export default function CncResults({result:r}) {
  const [position,setPosition]=useState(0),[view,setView]=useState('3D');
  const index=Math.min(position,r.frames.length-1),frame=r.frames[index],s=r.stats;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label="Removed volume" value={`${(s.removedTotal/1000).toFixed(2)} cm³`} sub={r.name}/>
      <Stat label="Cutting time" value={`${s.cuttingMinutes.toFixed(2)} min`} sub="Feed moves only; no retracts/setup" mono/>
      <Stat label="Removal rate" value={`${(s.measuredRate/1000).toFixed(2)} cm³/min`} sub={`Nominal ${ (s.analyticRate/1000).toFixed(2)}; finite-grid model`} mono/>
      <Stat label="Chip load" value={`${s.chipLoad.toFixed(4)} mm/tooth`} sub={`${s.cuttingSpeed.toFixed(0)} m/min surface speed`} mono/>
    </div>
    <Panel className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">Workpiece replay</h3><Seg value={view} onChange={setView} options={['3D','Height map']}/></div>
      <Field label={`Snapshot ${index+1}/${r.frames.length} · move ${frame.step}/${r.moves.length-1} · ${(frame.removed/1000).toFixed(2)} cm³ removed`}><input aria-label="Workpiece snapshot" type="range" className="w-full accent-cyan-j" min="0" max={r.frames.length-1} value={index} onChange={e=>setPosition(Number(e.target.value))}/></Field>
      {view==='3D'?<CncSurface result={r} frame={frame}/>:<ScalarFieldCanvas label="Stock height above bottom (mm)" values={frame.values} rows={r.rows} cols={r.cols} min={r.target} max={r.stock.thickness}/>}
      <p className="text-xs text-muted-foreground">2.5D cutter envelope on {r.cols}×{r.rows} cells; sloped XYZ moves use nearest-planar-path interpolation. No undercuts, deformation, machine dynamics or rapid collision checks. Grid spacing: {(r.stock.width/r.cols).toFixed(3)}×{(r.stock.height/r.rows).toFixed(3)} mm.</p>
    </Panel>
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Kienzle force estimate" value={`${s.force.toFixed(1)} N`} sub="Single-chip approximation, uncalibrated"/><Stat label="Power estimate" value={`${s.power.toFixed(3)} kW`} sub="Not a spindle/tool safety recommendation"/><Stat label="Ideal ball scallop" value={`${s.scallop.toFixed(4)} mm`} sub={r.tool==='ball'?'Infinite parallel-pass geometry':'Flat cutter has zero ideal scallop'}/></div>
    <Panel className="space-y-3">
      <ScientificPlot series={[{label:'Removed volume (cm³)',points:r.curve.map(p=>({x:p.distance,y:p.removed/1000}))}]} xLabel="Travelled distance (mm)" yLabel="Volume (cm³)"/>
      <p className="text-xs text-muted-foreground">The simulation export includes every linear move, not a shortened sample. Validate with machine-specific CAM and a postprocessor before any physical machining.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>downloadBlob(new Blob([r.gcode],{type:'text/plain'}),'simulation-only.nc')}>Export simulation moves</Button><Button variant="outline" onClick={()=>downloadBlob(new Blob([Array.from({length:r.rows},(_,i)=>r.remaining.slice(i*r.cols,(i+1)*r.cols).join(',')).join('\n')],{type:'text/csv'}),'stock-height-mm.csv')}>Export height field CSV</Button></div>
    </Panel>
  </>;
}