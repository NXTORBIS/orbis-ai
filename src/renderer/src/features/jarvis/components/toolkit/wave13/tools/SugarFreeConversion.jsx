import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { confectioneryTools } from '@jarvis/components/toolkit/wave13/confectionery';
export default function SugarFreeConversion(){return <Wave13Workbench spec={confectioneryTools.find((t)=>t.id==='sugar-free-conversion')} group="confectionery" />;}