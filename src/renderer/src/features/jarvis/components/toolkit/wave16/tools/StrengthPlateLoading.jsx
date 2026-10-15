import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { strengthTools } from '@jarvis/components/toolkit/wave16/strength';
export default function StrengthPlateLoading(){return <Wave16Workbench spec={strengthTools.find((t)=>t.id==='strength-plate-loading')} group="strength" />;}