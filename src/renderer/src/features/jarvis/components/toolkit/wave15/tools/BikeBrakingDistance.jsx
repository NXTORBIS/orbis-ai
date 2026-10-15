import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { bicycleTools } from '@jarvis/components/toolkit/wave15/bicycle';
export default function BikeBrakingDistance(){return <Wave15Workbench spec={bicycleTools.find((t)=>t.id==='bike-braking-distance')} group="bicycle" />;}