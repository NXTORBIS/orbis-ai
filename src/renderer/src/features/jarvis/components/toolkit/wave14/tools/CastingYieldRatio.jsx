import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { foundryTools } from '@jarvis/components/toolkit/wave14/foundry';
export default function CastingYieldRatio(){return <Wave14Workbench spec={foundryTools.find((t)=>t.id==='casting-yield-ratio')} group="foundry" />;}