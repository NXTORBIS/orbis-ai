import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { anglingTools } from '@jarvis/components/toolkit/wave16/angling';
export default function AnglingLeaderFormula(){return <Wave16Workbench spec={anglingTools.find((t)=>t.id==='angling-leader-formula')} group="angling" />;}