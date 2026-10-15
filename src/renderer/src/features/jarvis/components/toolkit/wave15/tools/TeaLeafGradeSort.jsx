import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { teaTools } from '@jarvis/components/toolkit/wave15/tea';
export default function TeaLeafGradeSort(){return <Wave15Workbench spec={teaTools.find((t)=>t.id==='tea-leaf-grade-sort')} group="tea" />;}