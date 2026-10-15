import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { paperTools } from '@jarvis/components/toolkit/wave13/paper';
export default function HeadboxFlowSlice(){return <Wave13Workbench spec={paperTools.find((t)=>t.id==='headbox-flow-slice')} group="paper" />;}