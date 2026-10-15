import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { foundryTools } from '@jarvis/components/toolkit/wave14/foundry';
export default function MeltEnergyCost(){return <Wave14Workbench spec={foundryTools.find((t)=>t.id==='melt-energy-cost')} group="foundry" />;}