import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { elevatorsTools } from '@jarvis/components/toolkit/wave13/elevators';
export default function HydraulicJackPressure(){return <Wave13Workbench spec={elevatorsTools.find((t)=>t.id==='hydraulic-jack-pressure')} group="elevators" />;}