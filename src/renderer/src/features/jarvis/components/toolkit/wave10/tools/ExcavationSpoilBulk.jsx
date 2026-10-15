import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { estimatingTools } from '@jarvis/components/toolkit/wave10/estimating';
export default function ExcavationSpoilBulk(){return <Wave10Workbench spec={estimatingTools.find((t)=>t.id==='excavation-spoil-bulk')} group="estimating" />;}