import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { additiveTools } from '@jarvis/components/toolkit/wave15/additive';
export default function AmInfillStrength(){return <Wave15Workbench spec={additiveTools.find((t)=>t.id==='am-infill-strength')} group="additive" />;}