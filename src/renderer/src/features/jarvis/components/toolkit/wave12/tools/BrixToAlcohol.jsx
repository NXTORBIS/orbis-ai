import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { wineryTools } from '@jarvis/components/toolkit/wave12/winery';
export default function BrixToAlcohol(){return <Wave12Workbench spec={wineryTools.find((t)=>t.id==='brix-to-alcohol')} group="winery" />;}