import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { sportsTools } from '@jarvis/components/toolkit/wave9/sports';
export default function RpeSessionLoad(){return <Wave9Workbench spec={sportsTools.find((t)=>t.id==='rpe-session-load')} group="sports" />;}