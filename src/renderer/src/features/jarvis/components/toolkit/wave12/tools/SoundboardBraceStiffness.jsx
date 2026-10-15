import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { luthieryTools } from '@jarvis/components/toolkit/wave12/luthiery';
export default function SoundboardBraceStiffness(){return <Wave12Workbench spec={luthieryTools.find((t)=>t.id==='soundboard-brace-stiffness')} group="luthiery" />;}