import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { optometryTools } from '@jarvis/components/toolkit/wave11/optometry';
export default function IolPowerSrk(){return <Wave11Workbench spec={optometryTools.find((t)=>t.id==='iol-power-srk')} group="optometry" />;}