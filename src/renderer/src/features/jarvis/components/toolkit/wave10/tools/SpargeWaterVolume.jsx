import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { brewingTools } from '@jarvis/components/toolkit/wave10/brewing';
export default function SpargeWaterVolume(){return <Wave10Workbench spec={brewingTools.find((t)=>t.id==='sparge-water-volume')} group="brewing" />;}