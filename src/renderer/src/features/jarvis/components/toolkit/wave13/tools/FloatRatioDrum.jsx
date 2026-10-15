import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { leatherTools } from '@jarvis/components/toolkit/wave13/leather';
export default function FloatRatioDrum(){return <Wave13Workbench spec={leatherTools.find((t)=>t.id==='float-ratio-drum')} group="leather" />;}