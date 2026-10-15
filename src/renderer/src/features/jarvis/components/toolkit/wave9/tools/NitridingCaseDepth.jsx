import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { metallurgyTools } from '@jarvis/components/toolkit/wave9/metallurgy';
export default function NitridingCaseDepth(){return <Wave9Workbench spec={metallurgyTools.find((t)=>t.id==='nitriding-case-depth')} group="metallurgy" />;}