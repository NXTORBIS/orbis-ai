import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { mushroomTools } from '@jarvis/components/toolkit/wave14/mushroom';
export default function BiologicalEfficiency(){return <Wave14Workbench spec={mushroomTools.find((t)=>t.id==='biological-efficiency')} group="mushroom" />;}