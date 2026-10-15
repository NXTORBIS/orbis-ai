import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { anglingTools } from '@jarvis/components/toolkit/wave16/angling';
export default function AnglingHookSetForce(){return <Wave16Workbench spec={anglingTools.find((t)=>t.id==='angling-hook-set-force')} group="angling" />;}