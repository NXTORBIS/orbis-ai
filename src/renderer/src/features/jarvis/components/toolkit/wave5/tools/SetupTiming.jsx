import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { digitalTools } from '@jarvis/components/toolkit/wave5/digital';
export default function SetupTiming() { return <Wave5Workbench spec={digitalTools[0]} group="digital" />; }