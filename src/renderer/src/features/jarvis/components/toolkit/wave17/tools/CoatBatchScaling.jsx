import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatBatchScaling(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-batch-scaling')} group="coatings" />;}