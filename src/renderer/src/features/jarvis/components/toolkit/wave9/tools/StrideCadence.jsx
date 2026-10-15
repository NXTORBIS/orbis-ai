import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { sportsTools } from '@jarvis/components/toolkit/wave9/sports';
export default function StrideCadence(){return <Wave9Workbench spec={sportsTools.find((t)=>t.id==='stride-cadence')} group="sports" />;}