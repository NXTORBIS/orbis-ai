import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { wineryTools } from '@jarvis/components/toolkit/wave12/winery';
export default function GrapeRipeningGdd(){return <Wave12Workbench spec={wineryTools.find((t)=>t.id==='grape-ripening-gdd')} group="winery" />;}