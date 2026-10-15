import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function BphTrainRatio(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='bph-train-ratio')} group="horology" />;}