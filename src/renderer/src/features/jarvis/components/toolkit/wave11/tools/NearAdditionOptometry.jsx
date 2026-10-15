import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { optometryTools } from '@jarvis/components/toolkit/wave11/optometry';
export default function NearAdditionOptometry(){return <Wave11Workbench spec={optometryTools.find((t)=>t.id==='near-addition-optometry')} group="optometry" />;}