import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { emsTools } from '@jarvis/components/toolkit/wave11/ems';
export default function CprCompressionFraction(){return <Wave11Workbench spec={emsTools.find((t)=>t.id==='cpr-compression-fraction')} group="ems" />;}