import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { anglingTools } from '@jarvis/components/toolkit/wave16/angling';
export default function AnglingCatchRate(){return <Wave16Workbench spec={anglingTools.find((t)=>t.id==='angling-catch-rate')} group="angling" />;}