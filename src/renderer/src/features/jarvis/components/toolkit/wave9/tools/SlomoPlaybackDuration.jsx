import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { broadcastTools } from '@jarvis/components/toolkit/wave9/broadcast';
export default function SlomoPlaybackDuration(){return <Wave9Workbench spec={broadcastTools.find((t)=>t.id==='slomo-playback-duration')} group="broadcast" />;}