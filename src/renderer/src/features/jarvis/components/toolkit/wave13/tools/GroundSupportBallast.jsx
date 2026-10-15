import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { riggingTools } from '@jarvis/components/toolkit/wave13/rigging';
export default function GroundSupportBallast(){return <Wave13Workbench spec={riggingTools.find((t)=>t.id==='ground-support-ballast')} group="rigging" />;}