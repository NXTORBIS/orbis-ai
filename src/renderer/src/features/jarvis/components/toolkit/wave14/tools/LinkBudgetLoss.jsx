import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function LinkBudgetLoss(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='link-budget-loss')} group="fibre" />;}