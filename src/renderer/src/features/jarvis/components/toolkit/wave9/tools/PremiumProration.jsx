import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { insuranceTools } from '@jarvis/components/toolkit/wave9/insurance';
export default function PremiumProration(){return <Wave9Workbench spec={insuranceTools.find((t)=>t.id==='premium-proration')} group="insurance" />;}