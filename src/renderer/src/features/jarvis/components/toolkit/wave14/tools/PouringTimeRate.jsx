import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { foundryTools } from '@jarvis/components/toolkit/wave14/foundry';
export default function PouringTimeRate(){return <Wave14Workbench spec={foundryTools.find((t)=>t.id==='pouring-time-rate')} group="foundry" />;}