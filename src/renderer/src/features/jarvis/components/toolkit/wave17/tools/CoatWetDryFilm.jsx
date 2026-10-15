import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatWetDryFilm(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-wet-dry-film')} group="coatings" />;}