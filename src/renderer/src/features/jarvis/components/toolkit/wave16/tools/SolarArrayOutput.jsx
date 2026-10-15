import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { solarTools } from '@jarvis/components/toolkit/wave16/solar';
export default function SolarArrayOutput(){return <Wave16Workbench spec={solarTools.find((t)=>t.id==='solar-array-output')} group="solar" />;}