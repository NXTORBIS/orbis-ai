import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { hospitalityTools } from '@jarvis/components/toolkit/wave11/hospitality';
export default function BeverageInventoryPar(){return <Wave11Workbench spec={hospitalityTools.find((t)=>t.id==='beverage-inventory-par')} group="hospitality" />;}