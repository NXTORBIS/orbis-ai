import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { estimatingTools } from '@jarvis/components/toolkit/wave10/estimating';
export default function RoofAreaPitch(){return <Wave10Workbench spec={estimatingTools.find((t)=>t.id==='roof-area-pitch')} group="estimating" />;}