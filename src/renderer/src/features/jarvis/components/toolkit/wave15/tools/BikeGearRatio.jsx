import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { bicycleTools } from '@jarvis/components/toolkit/wave15/bicycle';
export default function BikeGearRatio(){return <Wave15Workbench spec={bicycleTools.find((t)=>t.id==='bike-gear-ratio')} group="bicycle" />;}