import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { photographyTools } from '@jarvis/components/toolkit/wave10/photography';
export default function GimbalTimelapsePan(){return <Wave10Workbench spec={photographyTools.find((t)=>t.id==='gimbal-timelapse-pan')} group="photography" />;}