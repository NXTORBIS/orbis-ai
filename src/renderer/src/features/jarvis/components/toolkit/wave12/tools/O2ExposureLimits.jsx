import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { divingTools } from '@jarvis/components/toolkit/wave12/diving';
export default function O2ExposureLimits(){return <Wave12Workbench spec={divingTools.find((t)=>t.id==='o2-exposure-limits')} group="diving" />;}