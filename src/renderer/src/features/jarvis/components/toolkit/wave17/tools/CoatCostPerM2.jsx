import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { coatingsTools } from '@jarvis/components/toolkit/wave17/coatings';
export default function CoatCostPerM2(){return <Wave17Workbench spec={coatingsTools.find((t)=>t.id==='coat-cost-per-m2')} group="coatings" />;}