import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { wastewaterTools } from '@jarvis/components/toolkit/wave13/wastewater';
export default function ChlorineDose(){return <Wave13Workbench spec={wastewaterTools.find((t)=>t.id==='chlorine-dose')} group="wastewater" />;}