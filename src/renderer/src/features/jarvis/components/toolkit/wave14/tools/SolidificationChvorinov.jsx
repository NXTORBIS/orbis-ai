import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { foundryTools } from '@jarvis/components/toolkit/wave14/foundry';
export default function SolidificationChvorinov(){return <Wave14Workbench spec={foundryTools.find((t)=>t.id==='solidification-chvorinov')} group="foundry" />;}