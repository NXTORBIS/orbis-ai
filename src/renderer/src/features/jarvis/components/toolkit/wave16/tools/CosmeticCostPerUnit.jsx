import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { cosmeticTools } from '@jarvis/components/toolkit/wave16/cosmetic';
export default function CosmeticCostPerUnit(){return <Wave16Workbench spec={cosmeticTools.find((t)=>t.id==='cosmetic-cost-per-unit')} group="cosmetic" />;}