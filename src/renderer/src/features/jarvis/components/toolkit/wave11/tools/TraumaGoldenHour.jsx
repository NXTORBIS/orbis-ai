import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { emsTools } from '@jarvis/components/toolkit/wave11/ems';
export default function TraumaGoldenHour(){return <Wave11Workbench spec={emsTools.find((t)=>t.id==='trauma-golden-hour')} group="ems" />;}