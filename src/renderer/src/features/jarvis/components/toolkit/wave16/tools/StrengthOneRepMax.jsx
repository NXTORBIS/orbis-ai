import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { strengthTools } from '@jarvis/components/toolkit/wave16/strength';
export default function StrengthOneRepMax(){return <Wave16Workbench spec={strengthTools.find((t)=>t.id==='strength-one-rep-max')} group="strength" />;}