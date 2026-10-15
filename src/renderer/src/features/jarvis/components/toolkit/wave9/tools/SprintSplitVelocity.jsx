import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { sportsTools } from '@jarvis/components/toolkit/wave9/sports';
export default function SprintSplitVelocity(){return <Wave9Workbench spec={sportsTools.find((t)=>t.id==='sprint-split-velocity')} group="sports" />;}