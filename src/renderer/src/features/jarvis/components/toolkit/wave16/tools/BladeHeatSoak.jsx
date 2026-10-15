import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { bladeTools } from '@jarvis/components/toolkit/wave16/blade';
export default function BladeHeatSoak(){return <Wave16Workbench spec={bladeTools.find((t)=>t.id==='blade-heat-soak')} group="blade" />;}