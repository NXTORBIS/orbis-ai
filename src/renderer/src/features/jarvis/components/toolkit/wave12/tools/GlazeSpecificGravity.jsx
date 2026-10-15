import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { ceramicsTools } from '@jarvis/components/toolkit/wave12/ceramics';
export default function GlazeSpecificGravity(){return <Wave12Workbench spec={ceramicsTools.find((t)=>t.id==='glaze-specific-gravity')} group="ceramics" />;}