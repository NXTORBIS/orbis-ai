import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { emsTools } from '@jarvis/components/toolkit/wave11/ems';
export default function ShockIndexVitals(){return <Wave11Workbench spec={emsTools.find((t)=>t.id==='shock-index-vitals')} group="ems" />;}