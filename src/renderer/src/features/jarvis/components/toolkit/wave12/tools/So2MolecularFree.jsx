import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { wineryTools } from '@jarvis/components/toolkit/wave12/winery';
export default function So2MolecularFree(){return <Wave12Workbench spec={wineryTools.find((t)=>t.id==='so2-molecular-free')} group="winery" />;}