import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { workshopTools } from '@jarvis/components/toolkit/wave12/workshop';
export default function FuelTrimDiagnostic(){return <Wave12Workbench spec={workshopTools.find((t)=>t.id==='fuel-trim-diagnostic')} group="workshop" />;}