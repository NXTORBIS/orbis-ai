import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function WatchWaterResistance(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='watch-water-resistance')} group="horology" />;}