import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { metallurgyTools } from '@jarvis/components/toolkit/wave9/metallurgy';
export default function JominyDistance(){return <Wave9Workbench spec={metallurgyTools.find((t)=>t.id==='jominy-distance')} group="metallurgy" />;}