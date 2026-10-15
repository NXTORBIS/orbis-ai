import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { additiveTools } from '@jarvis/components/toolkit/wave15/additive';
export default function AmBuildPlateNesting(){return <Wave15Workbench spec={additiveTools.find((t)=>t.id==='am-build-plate-nesting')} group="additive" />;}