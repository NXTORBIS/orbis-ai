import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { soapTools } from '@jarvis/components/toolkit/wave16/soap';
export default function SoapCureTime(){return <Wave16Workbench spec={soapTools.find((t)=>t.id==='soap-cure-time')} group="soap" />;}