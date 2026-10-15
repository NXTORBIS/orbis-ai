import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { bladeTools } from '@jarvis/components/toolkit/wave16/blade';
export default function BladeBevelAngle(){return <Wave16Workbench spec={bladeTools.find((t)=>t.id==='blade-bevel-angle')} group="blade" />;}