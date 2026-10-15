import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { analyticalTools } from '@jarvis/components/toolkit/wave5/analytical';
export default function PlateEfficiency() { return <Wave5Workbench spec={analyticalTools[4]} group="analytical" />; }