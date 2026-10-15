import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { climbingTools } from '@jarvis/components/toolkit/wave16/climbing';
export default function ClimbRouteTime(){return <Wave16Workbench spec={climbingTools.find((t)=>t.id==='climb-route-time')} group="climbing" />;}