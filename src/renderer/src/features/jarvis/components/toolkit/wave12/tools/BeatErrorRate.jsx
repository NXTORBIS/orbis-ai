import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function BeatErrorRate(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='beat-error-rate')} group="horology" />;}