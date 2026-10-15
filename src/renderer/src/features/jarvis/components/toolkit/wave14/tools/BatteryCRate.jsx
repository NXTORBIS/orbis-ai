import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { droneTools } from '@jarvis/components/toolkit/wave14/drone';
export default function BatteryCRate(){return <Wave14Workbench spec={droneTools.find((t)=>t.id==='battery-c-rate')} group="drone" />;}