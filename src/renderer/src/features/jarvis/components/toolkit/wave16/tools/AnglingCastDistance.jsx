import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { anglingTools } from '@jarvis/components/toolkit/wave16/angling';
export default function AnglingCastDistance(){return <Wave16Workbench spec={anglingTools.find((t)=>t.id==='angling-cast-distance')} group="angling" />;}