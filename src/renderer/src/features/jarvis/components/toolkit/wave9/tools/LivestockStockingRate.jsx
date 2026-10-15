import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { veterinaryTools } from '@jarvis/components/toolkit/wave9/veterinary';
export default function LivestockStockingRate(){return <Wave9Workbench spec={veterinaryTools.find((t)=>t.id==='livestock-stocking-rate')} group="veterinary" />;}