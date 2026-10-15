import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { airqualityTools } from '@jarvis/components/toolkit/wave17/airquality';
export default function AirDuctVelocity(){return <Wave17Workbench spec={airqualityTools.find((t)=>t.id==='air-duct-velocity')} group="airquality" />;}