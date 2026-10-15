import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function ClockWeightRuntime(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='clock-weight-runtime')} group="horology" />;}