import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function WatchAmplitudeEnergy(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='watch-amplitude-energy')} group="horology" />;}