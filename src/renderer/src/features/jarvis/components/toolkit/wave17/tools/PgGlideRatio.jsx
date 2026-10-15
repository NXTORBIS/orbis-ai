import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { paraglidingTools } from '@jarvis/components/toolkit/wave17/paragliding';
export default function PgGlideRatio(){return <Wave17Workbench spec={paraglidingTools.find((t)=>t.id==='pg-glide-ratio')} group="paragliding" />;}