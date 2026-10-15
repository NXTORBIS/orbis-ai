import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { insuranceTools } from '@jarvis/components/toolkit/wave9/insurance';
export default function MortalityChargePv(){return <Wave9Workbench spec={insuranceTools.find((t)=>t.id==='mortality-charge-pv')} group="insurance" />;}