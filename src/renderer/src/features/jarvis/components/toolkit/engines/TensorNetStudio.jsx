import { Network } from 'lucide-react';
import { TOPOLOGIES } from '@jarvis/components/toolkit/engines/tensorNetCore';
import useWorkbench from '@jarvis/components/toolkit/engines/useWorkbench';
import VisualizerFrame from '@jarvis/components/toolkit/engines/VisualizerFrame';
import VisualizerControls from '@jarvis/components/toolkit/engines/VisualizerControls';
import VisualizerJsonInput from '@jarvis/components/toolkit/engines/VisualizerJsonInput';
import TensorNetResults from '@jarvis/components/toolkit/engines/TensorNetResults';
const DEFAULT={topology:'mps-norm',length:4,chi:3,d:2,seed:11,order:'optimal',input:''};
const FIELDS=[{key:'topology',label:'Network',options:Object.entries(TOPOLOGIES).map(([value,{label}])=>({value,label}))},{key:'length',label:'Chain sites / random nodes',min:2,max:4},{key:'chi',label:'Bond dimension χ',min:1,max:4},{key:'d',label:'Physical dimension d',min:2,max:3},{key:'seed',label:'Coefficient seed',min:1,max:99999},{key:'order',label:'Contraction order',options:[{value:'optimal',label:'Exact DP (up to 9 tensors)'},{value:'greedy-work',label:'Greedy work'},{value:'greedy-memory',label:'Greedy memory'},{value:'sweep',label:'Left-to-right sweep'}]}];
const EXAMPLE=JSON.stringify({dims:{i:2,j:2,k:2},tensors:[{id:'A',legs:['i','j'],values:[1,2,3,4]},{id:'B',legs:['j','k'],values:[5,6,7,8]}]},null,2);
export default function TensorNetStudio() {
  const work=useWorkbench('tensorNet',DEFAULT);
  return <VisualizerFrame work={work} kind="tensorNet" toolId="tensor-network" icon={Network} title="Tensor Network Contraction" desc="Real dense Einstein contractions, exact subset-DP ordering and greedy alternatives. Replay tensor merges, compare multiplication counts and intermediate memory, and inspect the actual output." controls={<>
    <VisualizerControls state={work.state} onChange={work.setState} fields={FIELDS}/>
    <VisualizerJsonInput value={work.state.input} onChange={input=>work.setState({...work.state,input})} example={EXAMPLE} description="2–8 real tensors, explicit dimensions, row-major values, and pairwise named indices; open indices are retained. Tree and grid models use fixed layouts. Exact search is used only up to 9 tensors; larger models use greedy orders."/>
  </>}>
    {work.result&&<TensorNetResults result={work.result}/>}
  </VisualizerFrame>;
}