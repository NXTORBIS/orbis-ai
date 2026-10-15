import { Workflow } from 'lucide-react';
import { SCENARIOS } from '@jarvis/components/toolkit/engines/traceCore';
import useWorkbench from '@jarvis/components/toolkit/engines/useWorkbench';
import VisualizerFrame from '@jarvis/components/toolkit/engines/VisualizerFrame';
import VisualizerControls from '@jarvis/components/toolkit/engines/VisualizerControls';
import VisualizerJsonInput from '@jarvis/components/toolkit/engines/VisualizerJsonInput';
import DistributedTraceResults from '@jarvis/components/toolkit/engines/DistributedTraceResults';
const DEFAULT={scenario:'checkout',seed:3,slowQuery:true,input:''};
const EXAMPLE=JSON.stringify({spans:[{id:'r',parent:null,service:'gateway',name:'request',start:0,duration:100},{id:'a',parent:'r',service:'catalog',name:'fetch',start:10,duration:30},{id:'b',parent:'r',service:'payments',name:'authorize',start:10,duration:70}]},null,2);
export default function DistributedTraceStudio() {
  const work=useWorkbench('distributedTrace',DEFAULT);
  return <VisualizerFrame work={work} kind="distributedTrace" toolId="trace-critical-path" icon={Workflow} title="Distributed Trace Critical Path" desc="Reconstruct nested service spans into an inspectable waterfall. Attribute serial waits and parallel joins without double-counting intervals; compare exclusive service time and fork/join latency estimates." controls={<>
    <VisualizerControls state={work.state} onChange={work.setState} fields={[{key:'scenario',label:'Synthetic scenario',options:Object.entries(SCENARIOS).map(([value,{label}])=>({value,label}))},{key:'seed',label:'Timing seed',min:1,max:9999}]}/>
    <VisualizerJsonInput value={work.state.input} onChange={input=>work.setState({...work.state,input})} example={EXAMPLE} description={'Canonical trace: {"spans":[{"id":"…","parent":null,"service":"…","name":"…","start":0,"duration":100}]}. Times are milliseconds on one synchronized trace clock. Mark detached work async:true. Supports ≤300 spans, not raw OTLP/Jaeger exports; normalize those first.'}/>
  </>}>
    {work.result&&<DistributedTraceResults result={work.result}/>}
  </VisualizerFrame>;
}