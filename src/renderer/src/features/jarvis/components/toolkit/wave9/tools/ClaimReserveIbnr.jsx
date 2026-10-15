import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { insuranceTools } from '@jarvis/components/toolkit/wave9/insurance';
export default function ClaimReserveIbnr(){return <Wave9Workbench spec={insuranceTools.find((t)=>t.id==='claim-reserve-ibnr')} group="insurance" />;}