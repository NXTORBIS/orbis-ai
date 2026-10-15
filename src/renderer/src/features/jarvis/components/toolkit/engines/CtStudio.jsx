import { ScanLine } from 'lucide-react';
import { PHANTOMS, FILTERS } from '@jarvis/components/toolkit/engines/ctCore';
import useWorkbench from '@jarvis/components/toolkit/engines/useWorkbench';
import VisualizerFrame from '@jarvis/components/toolkit/engines/VisualizerFrame';
import VisualizerControls from '@jarvis/components/toolkit/engines/VisualizerControls';
import VisualizerJsonInput from '@jarvis/components/toolkit/engines/VisualizerJsonInput';
import CtResults from '@jarvis/components/toolkit/engines/CtResults';
const DEFAULT={phantom:'shepp-logan',angles:60,detectors:80,n:40,filter:'hann',iterations:16,noise:0,input:''};
const options=map=>Object.entries(map).map(([value,{label}])=>({value,label}));
const FIELDS=[{key:'phantom',label:'Analytic phantom',options:options(PHANTOMS)},{key:'filter',label:'FBP filter',options:options(FILTERS)},{key:'angles',label:'Projection angles',min:12,max:180},{key:'detectors',label:'Detector bins',min:24,max:160},{key:'n',label:'Reconstruction side (pixels)',min:24,max:64,step:8},{key:'iterations',label:'SIRT iterations',min:1,max:40},{key:'noise',label:'Projection noise fraction',min:0,max:0.06,step:0.005}];
export default function CtStudio() {
  const work=useWorkbench('ct',DEFAULT);
  const controls=<>
    <VisualizerControls state={work.state} onChange={work.setState} fields={FIELDS}/>
    <VisualizerJsonInput value={work.state.input} onChange={input=>work.setState({...work.state,input})} description={'Supported format: {"extent":1,"projections":[[...],...]}. Each row is one uniformly spaced angle over [0°,180°); 8–180 rows, 16–160 equally spaced detector readings across [−extent,+extent]. No DICOM or fan-beam data.'}/>
  </>;
  return <VisualizerFrame work={work} kind="ct" toolId="ct-reconstruction" icon={ScanLine} title="Computed Tomography Reconstruction" desc="Compare Fourier ramp-filtered backprojection with row/column-normalized SIRT. Inspect the sinogram, iterations, residuals and ground-truth error; paste compatible numeric measurements." controls={controls}>
    {work.result&&<CtResults key={work.result.name+work.result.iterations} result={work.result}/>}
  </VisualizerFrame>;
}