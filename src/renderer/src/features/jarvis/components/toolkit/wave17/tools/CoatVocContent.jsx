import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatVocContent(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-voc-content')} group="coatings" />;}