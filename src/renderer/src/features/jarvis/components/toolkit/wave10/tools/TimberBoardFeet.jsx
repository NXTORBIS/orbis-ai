import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { forestryTools } from '@jarvis/components/toolkit/wave10/forestry';
export default function TimberBoardFeet(){return <Wave10Workbench spec={forestryTools.find((t)=>t.id==='timber-board-feet')} group="forestry" />;}