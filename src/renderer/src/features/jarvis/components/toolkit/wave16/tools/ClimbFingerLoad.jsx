import Wave16Workbench from '@jarvis/components/toolkit/wave16/Wave16Workbench';
import { climbingTools } from '@jarvis/components/toolkit/wave16/climbing';
export default function ClimbFingerLoad(){return <Wave16Workbench spec={climbingTools.find((t)=>t.id==='climb-finger-load')} group="climbing" />;}