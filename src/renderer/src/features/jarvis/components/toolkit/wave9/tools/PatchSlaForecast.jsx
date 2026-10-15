import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { cyberopsTools } from '@jarvis/components/toolkit/wave9/cyberops';
export default function PatchSlaForecast(){return <Wave9Workbench spec={cyberopsTools.find((t)=>t.id==='patch-sla-forecast')} group="cyberops" />;}