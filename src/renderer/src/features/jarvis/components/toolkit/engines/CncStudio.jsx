import { Wrench } from 'lucide-react';
import { MATERIALS } from '@jarvis/components/toolkit/engines/cncCore';
import useWorkbench from '@jarvis/components/toolkit/engines/useWorkbench';
import VisualizerFrame from '@jarvis/components/toolkit/engines/VisualizerFrame';
import VisualizerControls from '@jarvis/components/toolkit/engines/VisualizerControls';
import VisualizerJsonInput from '@jarvis/components/toolkit/engines/VisualizerJsonInput';
import CncResults from '@jarvis/components/toolkit/engines/CncResults';
const DEFAULT={pocket:'rectangle',path:'raster',tool:'flat',width:80,height:60,thickness:20,toolDiameter:10,stepover:0.45,depth:8,axial:2,feed:900,spindle:9000,flutes:3,material:'aluminium',input:''};
const FIELDS=[{key:'pocket',label:'Pocket',options:[{value:'rectangle',label:'Rectangle'},{value:'circle',label:'Circle'}]},{key:'path',label:'Strategy',options:[{value:'raster',label:'Raster'},{value:'contour',label:'Offset contour'},{value:'spiral',label:'Spiral (circle only)'}]},{key:'tool',label:'Cutter envelope',options:[{value:'flat',label:'Flat end mill'},{value:'ball',label:'Ball nose'}]},{key:'material',label:'Force-model material',options:Object.entries(MATERIALS).map(([value,{label}])=>({value,label}))},{key:'width',label:'Stock width (mm)',min:30,max:160},{key:'height',label:'Stock length (mm)',min:30,max:160},{key:'thickness',label:'Stock thickness (mm)',min:5,max:60},{key:'toolDiameter',label:'Cutter diameter (mm)',min:2,max:25},{key:'stepover',label:'Stepover / diameter',min:0.1,max:0.9,step:0.05},{key:'depth',label:'Total depth (mm)',min:0.5,max:59,step:0.5},{key:'axial',label:'Step-down (mm)',min:0.5,max:10,step:0.5},{key:'feed',label:'Feed (mm/min)',min:50,max:6000,step:50},{key:'spindle',label:'Spindle (rpm)',min:500,max:24000,step:500},{key:'flutes',label:'Flutes',min:1,max:6}];
const EXAMPLE=JSON.stringify({points:[[-20,-10,-2],[20,-10,-2],[20,0,-2],[-20,0,-2],[-20,10,-2],[20,10,-2]]},null,2);
export default function CncStudio() {
  const work=useWorkbench('cnc',DEFAULT);
  return <VisualizerFrame work={work} kind="cnc" toolId="cnc-removal" icon={Wrench} title="CNC Toolpath Material Removal" desc="Sweep real cutter envelopes through a cell-centred stock model. Replay the evolving workpiece in 3D, compare removal rate and scallop geometry, or simulate your own linear centre path." controls={<>
    <VisualizerControls state={work.state} onChange={work.setState} fields={FIELDS}/>
    <VisualizerJsonInput value={work.state.input} onChange={input=>work.setState({...work.state,input})} example={EXAMPLE} description="Linear XYZ cutting moves in mm: X/Y are centred on the stock, Z is zero at its top and negative below it. Flat and ball cutters; no undercuts, rapid moves, arcs, or machine-controller emulation. Custom paths override pocket depth and strategy."/>
  </>}>
    {work.result&&<CncResults result={work.result}/>}
  </VisualizerFrame>;
}