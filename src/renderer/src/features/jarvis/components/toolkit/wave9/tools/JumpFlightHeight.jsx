import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { sportsTools } from '@jarvis/components/toolkit/wave9/sports';
export default function JumpFlightHeight(){return <Wave9Workbench spec={sportsTools.find((t)=>t.id==='jump-flight-height')} group="sports" />;}