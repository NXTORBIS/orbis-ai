import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { weatherTools } from '@jarvis/components/toolkit/wave11/weather';
export default function CapeEstimate(){return <Wave11Workbench spec={weatherTools.find((t)=>t.id==='cape-estimate')} group="weather" />;}