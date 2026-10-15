import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { wastewaterTools } from '@jarvis/components/toolkit/wave13/wastewater';
export default function SludgeDewatering(){return <Wave13Workbench spec={wastewaterTools.find((t)=>t.id==='sludge-dewatering')} group="wastewater" />;}