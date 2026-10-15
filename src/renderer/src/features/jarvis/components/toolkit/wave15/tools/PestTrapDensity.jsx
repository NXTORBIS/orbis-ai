import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { pestTools } from '@jarvis/components/toolkit/wave15/pest';
export default function PestTrapDensity(){return <Wave15Workbench spec={pestTools.find((t)=>t.id==='pest-trap-density')} group="pest" />;}