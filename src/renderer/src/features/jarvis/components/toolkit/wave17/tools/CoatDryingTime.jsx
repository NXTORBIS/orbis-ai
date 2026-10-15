import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatDryingTime(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-drying-time')} group="coatings" />;}