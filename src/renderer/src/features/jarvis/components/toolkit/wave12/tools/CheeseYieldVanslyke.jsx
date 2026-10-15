import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { dairyTools } from '@jarvis/components/toolkit/wave12/dairy';
export default function CheeseYieldVanslyke(){return <Wave12Workbench spec={dairyTools.find((t)=>t.id==='cheese-yield-vanslyke')} group="dairy" />;}