import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { bakeryTools } from '@jarvis/components/toolkit/wave14/bakery';
export default function BreadCostLoaf(){return <Wave14Workbench spec={bakeryTools.find((t)=>t.id==='bread-cost-loaf')} group="bakery" />;}