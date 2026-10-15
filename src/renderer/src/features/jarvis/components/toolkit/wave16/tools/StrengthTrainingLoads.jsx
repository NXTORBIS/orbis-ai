import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { strengthTools } from '@jarvis/components/toolkit/wave16/strength';
export default function StrengthTrainingLoads(){return <Wave16Workbench spec={strengthTools.find((t)=>t.id==='strength-training-loads')} group="strength" />;}