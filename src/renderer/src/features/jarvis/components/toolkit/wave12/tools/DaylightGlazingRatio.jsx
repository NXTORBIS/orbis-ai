import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { glazingTools } from '@jarvis/components/toolkit/wave12/glazing';
export default function DaylightGlazingRatio(){return <Wave12Workbench spec={glazingTools.find((t)=>t.id==='daylight-glazing-ratio')} group="glazing" />;}