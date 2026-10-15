import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { wineryTools } from '@jarvis/components/toolkit/wave12/winery';
export default function PressYieldTonne(){return <Wave12Workbench spec={wineryTools.find((t)=>t.id==='press-yield-tonne')} group="winery" />;}