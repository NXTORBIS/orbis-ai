import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { workshopTools } from '@jarvis/components/toolkit/wave12/workshop';
export default function BrakePadLife(){return <Wave12Workbench spec={workshopTools.find((t)=>t.id==='brake-pad-life')} group="workshop" />;}