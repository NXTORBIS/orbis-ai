import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { optometryTools } from '@jarvis/components/toolkit/wave11/optometry';
export default function PdSegmentHeight(){return <Wave11Workbench spec={optometryTools.find((t)=>t.id==='pd-segment-height')} group="optometry" />;}