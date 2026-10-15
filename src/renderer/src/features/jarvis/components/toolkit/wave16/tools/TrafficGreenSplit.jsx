import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { trafficTools } from '@jarvis/components/toolkit/wave16/traffic';
export default function TrafficGreenSplit(){return <Wave16Workbench spec={trafficTools.find((t)=>t.id==='traffic-green-split')} group="traffic" />;}