import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { archeryTools } from '@jarvis/components/toolkit/wave14/archery';
export default function TrajectoryDropSight(){return <Wave14Workbench spec={archeryTools.find((t)=>t.id==='trajectory-drop-sight')} group="archery" />;}