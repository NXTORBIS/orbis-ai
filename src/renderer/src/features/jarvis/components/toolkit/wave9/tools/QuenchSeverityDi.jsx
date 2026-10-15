import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { metallurgyTools } from '@jarvis/components/toolkit/wave9/metallurgy';
export default function QuenchSeverityDi(){return <Wave9Workbench spec={metallurgyTools.find((t)=>t.id==='quench-severity-di')} group="metallurgy" />;}