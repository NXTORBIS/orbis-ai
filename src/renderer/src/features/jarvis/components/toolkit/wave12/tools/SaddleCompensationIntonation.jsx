import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { luthieryTools } from '@jarvis/components/toolkit/wave12/luthiery';
export default function SaddleCompensationIntonation(){return <Wave12Workbench spec={luthieryTools.find((t)=>t.id==='saddle-compensation-intonation')} group="luthiery" />;}