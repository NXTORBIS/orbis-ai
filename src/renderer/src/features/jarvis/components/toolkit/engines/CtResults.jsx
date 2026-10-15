import { useState } from 'react';
import { Panel, Stat, Field, downloadBlob } from '@jarvis/components/toolkit/shared';
import { Button } from '@jarvis/components/ui/button';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScalarFieldCanvas from '@jarvis/components/toolkit/engines/ScalarFieldCanvas';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
export default function CtResults({result:r}) {
  const [iteration,setIteration]=useState(r.iterations),[angle,setAngle]=useState(0);
  const image=r.frames[iteration],max=Math.max(...r.sirt,...r.fbp,...(r.phantom||[])),min=Math.min(0,...r.fbp);
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label="SIRT data residual" value={`${(r.curve[iteration].residual*100).toFixed(2)}%`} sub={`iteration ${iteration}`} />
      <Stat label="FBP data residual" value={`${(r.metrics.fbp.residual*100).toFixed(2)}%`} mono/>
      <Stat label="SIRT ground-truth RMSE" value={r.curve[iteration].rmse===null?'Unavailable':r.curve[iteration].rmse.toFixed(4)} sub={r.phantom?'Against analytic phantom':'Not known for pasted measurements'} mono/>
      <Stat label="Projection geometry" value={`${r.angles} × ${r.detectors}`} sub={`${r.n} × ${r.n} reconstruction`} mono/>
    </div>
    <Panel className="space-y-3">
      <p className="text-xs text-muted-foreground">{r.note} Image panels share the same density scale; sinogram uses its own measurement scale. Reconstruction error and data residual are different quantities.</p>
      <Field label={`Inspect SIRT iteration ${iteration}`}><input aria-label="SIRT iteration" className="w-full accent-cyan-j" type="range" min="0" max={r.iterations} value={iteration} onChange={e=>setIteration(Number(e.target.value))}/></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <ScalarFieldCanvas label="Sinogram · angle rows / detector columns" {...r.sinogram}/>
        {r.phantom&&<ScalarFieldCanvas label="Known phantom" values={r.phantom} rows={r.n} cols={r.n} min={min} max={max}/>}
        <ScalarFieldCanvas label="Filtered backprojection" values={r.fbp} rows={r.n} cols={r.n} min={min} max={max}/>
        <ScalarFieldCanvas label={`SIRT iteration ${iteration}`} values={image} rows={r.n} cols={r.n} min={min} max={max}/>
      </div>
    </Panel>
    <Panel className="space-y-3">
      <ScientificPlot series={[{label:'Relative data residual',points:r.curve.map(p=>({x:p.iteration,y:p.residual}))}]} xLabel="Iteration" yLabel="Residual"/>
      <Field label={`Projection angle ${(angle*180/r.angles).toFixed(1)}°`}><input aria-label="Projection angle" className="w-full accent-cyan-j" type="range" min="0" max={r.angles-1} value={angle} onChange={e=>setAngle(Number(e.target.value))}/></Field>
      <ScientificPlot series={[{label:'Line integral',points:r.projections[angle].map((y,i)=>({x:(i-(r.detectors-1)/2)*r.ds,y}))}]} xLabel="Detector position" yLabel="Projection"/>
      <Button variant="outline" onClick={()=>downloadBlob(new Blob([JSON.stringify({extent:r.extent,projections:r.projections})],{type:'application/json'}),'ct-measurements.json')}>Export reusable measurements</Button>
    </Panel>
  </>;
}