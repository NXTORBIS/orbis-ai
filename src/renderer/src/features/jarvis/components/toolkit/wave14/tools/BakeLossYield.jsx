import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { bakeryTools } from '@jarvis/components/toolkit/wave14/bakery';
export default function BakeLossYield(){return <Wave14Workbench spec={bakeryTools.find((t)=>t.id==='bake-loss-yield')} group="bakery" />;}