import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { ceramicsTools } from '@jarvis/components/toolkit/wave12/ceramics';
export default function WheelThrowingClayMass(){return <Wave12Workbench spec={ceramicsTools.find((t)=>t.id==='wheel-throwing-clay-mass')} group="ceramics" />;}