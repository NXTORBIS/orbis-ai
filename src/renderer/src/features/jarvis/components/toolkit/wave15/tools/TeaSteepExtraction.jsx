import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { teaTools } from '@jarvis/components/toolkit/wave15/tea';
export default function TeaSteepExtraction(){return <Wave15Workbench spec={teaTools.find((t)=>t.id==='tea-steep-extraction')} group="tea" />;}