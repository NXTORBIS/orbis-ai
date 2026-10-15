import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { bakeryTools } from '@jarvis/components/toolkit/wave14/bakery';
export default function HydrationAdjustment(){return <Wave14Workbench spec={bakeryTools.find((t)=>t.id==='hydration-adjustment')} group="bakery" />;}