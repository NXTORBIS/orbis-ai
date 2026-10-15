import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function SpliceConnectorBudget(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='splice-connector-budget')} group="fibre" />;}