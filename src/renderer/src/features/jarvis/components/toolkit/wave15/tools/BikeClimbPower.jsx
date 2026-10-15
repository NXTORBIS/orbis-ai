import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { bicycleTools } from '@jarvis/components/toolkit/wave15/bicycle';
export default function BikeClimbPower(){return <Wave15Workbench spec={bicycleTools.find((t)=>t.id==='bike-climb-power')} group="bicycle" />;}