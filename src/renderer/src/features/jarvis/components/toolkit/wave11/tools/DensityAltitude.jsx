import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { dispatchTools } from '@jarvis/components/toolkit/wave11/dispatch';
export default function DensityAltitude(){return <Wave11Workbench spec={dispatchTools.find((t)=>t.id==='density-altitude')} group="dispatch" />;}