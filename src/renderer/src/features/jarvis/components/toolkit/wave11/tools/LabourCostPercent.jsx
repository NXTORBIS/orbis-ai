import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { hospitalityTools } from '@jarvis/components/toolkit/wave11/hospitality';
export default function LabourCostPercent(){return <Wave11Workbench spec={hospitalityTools.find((t)=>t.id==='labour-cost-percent')} group="hospitality" />;}