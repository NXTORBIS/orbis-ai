import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { confectioneryTools } from '@jarvis/components/toolkit/wave13/confectionery';
export default function ChocolateFatBalance(){return <Wave13Workbench spec={confectioneryTools.find((t)=>t.id==='chocolate-fat-balance')} group="confectionery" />;}