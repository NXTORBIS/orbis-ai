import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { analyticalTools } from '@jarvis/components/toolkit/wave5/analytical';
export default function SolventBlend() { return <Wave5Workbench spec={analyticalTools[5]} group="analytical" />; }