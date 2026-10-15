import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { workshopTools } from '@jarvis/components/toolkit/wave12/workshop';
export default function BatteryCrankingHealth(){return <Wave12Workbench spec={workshopTools.find((t)=>t.id==='battery-cranking-health')} group="workshop" />;}