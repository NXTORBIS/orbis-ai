import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { strengthTools } from '@jarvis/components/toolkit/wave16/strength';
export default function StrengthBodyweightRatio(){return <Wave16Workbench spec={strengthTools.find((t)=>t.id==='strength-bodyweight-ratio')} group="strength" />;}