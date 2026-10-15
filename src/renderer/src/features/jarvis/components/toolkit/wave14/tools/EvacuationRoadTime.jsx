import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { wildfireTools } from '@jarvis/components/toolkit/wave14/wildfire';
export default function EvacuationRoadTime(){return <Wave14Workbench spec={wildfireTools.find((t)=>t.id==='evacuation-road-time')} group="wildfire" />;}