import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { optometryTools } from '@jarvis/components/toolkit/wave11/optometry';
export default function PrismDecentration(){return <Wave11Workbench spec={optometryTools.find((t)=>t.id==='prism-decentration')} group="optometry" />;}