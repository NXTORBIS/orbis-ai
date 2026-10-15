import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { leatherTools } from '@jarvis/components/toolkit/wave13/leather';
export default function LeatherCostArea(){return <Wave13Workbench spec={leatherTools.find((t)=>t.id==='leather-cost-area')} group="leather" />;}