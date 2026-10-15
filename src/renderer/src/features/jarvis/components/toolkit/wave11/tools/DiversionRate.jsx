import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { wasteTools } from '@jarvis/components/toolkit/wave11/waste';
export default function DiversionRate(){return <Wave11Workbench spec={wasteTools.find((t)=>t.id==='diversion-rate')} group="waste" />;}