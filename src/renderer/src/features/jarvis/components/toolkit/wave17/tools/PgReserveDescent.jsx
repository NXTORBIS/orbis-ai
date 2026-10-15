import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { paraglidingTools } from '@jarvis/components/toolkit/wave17/paragliding';
export default function PgReserveDescent(){return <Wave17Workbench spec={paraglidingTools.find((t)=>t.id==='pg-reserve-descent')} group="paragliding" />;}