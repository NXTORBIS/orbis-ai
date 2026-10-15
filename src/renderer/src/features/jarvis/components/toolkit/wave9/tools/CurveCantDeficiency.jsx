import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { railTools } from '@jarvis/components/toolkit/wave9/rail';
export default function CurveCantDeficiency(){return <Wave9Workbench spec={railTools.find((t)=>t.id==='curve-cant-deficiency')} group="rail" />;}