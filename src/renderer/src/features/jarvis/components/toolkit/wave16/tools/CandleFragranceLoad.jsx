import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { soapTools } from '@jarvis/components/toolkit/wave16/soap';
export default function CandleFragranceLoad(){return <Wave16Workbench spec={soapTools.find((t)=>t.id==='candle-fragrance-load')} group="soap" />;}