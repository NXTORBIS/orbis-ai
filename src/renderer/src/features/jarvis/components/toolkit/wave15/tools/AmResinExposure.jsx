import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { additiveTools } from '@jarvis/components/toolkit/wave15/additive';
export default function AmResinExposure(){return <Wave15Workbench spec={additiveTools.find((t)=>t.id==='am-resin-exposure')} group="additive" />;}