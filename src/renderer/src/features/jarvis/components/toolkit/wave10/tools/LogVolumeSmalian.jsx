import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { forestryTools } from '@jarvis/components/toolkit/wave10/forestry';
export default function LogVolumeSmalian(){return <Wave10Workbench spec={forestryTools.find((t)=>t.id==='log-volume-smalian')} group="forestry" />;}