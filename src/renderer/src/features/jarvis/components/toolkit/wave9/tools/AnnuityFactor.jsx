import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { insuranceTools } from '@jarvis/components/toolkit/wave9/insurance';
export default function AnnuityFactor(){return <Wave9Workbench spec={insuranceTools.find((t)=>t.id==='annuity-factor')} group="insurance" />;}