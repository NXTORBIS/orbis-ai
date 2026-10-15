import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function PonPowerBudget(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='pon-power-budget')} group="fibre" />;}