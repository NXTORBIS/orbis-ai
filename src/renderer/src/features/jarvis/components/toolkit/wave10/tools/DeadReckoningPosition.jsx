import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { navigationTools } from '@jarvis/components/toolkit/wave10/navigation';
export default function DeadReckoningPosition(){return <Wave10Workbench spec={navigationTools.find((t)=>t.id==='dead-reckoning-position')} group="navigation" />;}