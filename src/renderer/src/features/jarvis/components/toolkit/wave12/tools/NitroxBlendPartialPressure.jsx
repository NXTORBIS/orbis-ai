import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { divingTools } from '@jarvis/components/toolkit/wave12/diving';
export default function NitroxBlendPartialPressure(){return <Wave12Workbench spec={divingTools.find((t)=>t.id==='nitrox-blend-partial-pressure')} group="diving" />;}