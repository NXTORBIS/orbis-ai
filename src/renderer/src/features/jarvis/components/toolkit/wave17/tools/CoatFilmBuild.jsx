import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatFilmBuild(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-film-build')} group="coatings" />;}