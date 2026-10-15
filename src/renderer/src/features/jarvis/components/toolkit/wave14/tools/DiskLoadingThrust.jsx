import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { droneTools } from '@jarvis/components/toolkit/wave14/drone';
export default function DiskLoadingThrust(){return <Wave14Workbench spec={droneTools.find((t)=>t.id==='disk-loading-thrust')} group="drone" />;}