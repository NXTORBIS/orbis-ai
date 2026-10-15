import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { trafficTools } from '@jarvis/components/toolkit/wave16/traffic';
export default function TrafficRoadTripTime(){return <Wave16Workbench spec={trafficTools.find((t)=>t.id==='traffic-road-trip-time')} group="traffic" />;}