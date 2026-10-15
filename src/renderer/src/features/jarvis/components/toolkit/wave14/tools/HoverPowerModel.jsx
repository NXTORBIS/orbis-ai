import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { droneTools } from '@jarvis/components/toolkit/wave14/drone';
export default function HoverPowerModel(){return <Wave14Workbench spec={droneTools.find((t)=>t.id==='hover-power-model')} group="drone" />;}