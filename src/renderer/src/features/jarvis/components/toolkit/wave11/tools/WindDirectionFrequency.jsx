import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { weatherTools } from '@jarvis/components/toolkit/wave11/weather';
export default function WindDirectionFrequency(){return <Wave11Workbench spec={weatherTools.find((t)=>t.id==='wind-direction-frequency')} group="weather" />;}