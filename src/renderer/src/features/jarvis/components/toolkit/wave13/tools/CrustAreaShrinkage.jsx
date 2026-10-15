import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { leatherTools } from '@jarvis/components/toolkit/wave13/leather';
export default function CrustAreaShrinkage(){return <Wave13Workbench spec={leatherTools.find((t)=>t.id==='crust-area-shrinkage')} group="leather" />;}