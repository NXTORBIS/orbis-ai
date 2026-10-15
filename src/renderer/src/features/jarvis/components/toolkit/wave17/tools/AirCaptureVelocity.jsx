import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { airqualityTools } from '@jarvis/components/toolkit/wave17/airquality';
export default function AirCaptureVelocity(){return <Wave17Workbench spec={airqualityTools.find((t)=>t.id==='air-capture-velocity')} group="airquality" />;}