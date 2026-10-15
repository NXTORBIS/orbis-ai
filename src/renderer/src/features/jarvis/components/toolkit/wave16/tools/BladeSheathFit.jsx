import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { bladeTools } from '@jarvis/components/toolkit/wave16/blade';
export default function BladeSheathFit(){return <Wave16Workbench spec={bladeTools.find((t)=>t.id==='blade-sheath-fit')} group="blade" />;}