import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatPigmentVolume(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-pigment-volume')} group="coatings" />;}