import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { civilTools } from '@jarvis/components/toolkit/wave5/civil';
export default function CircularCurve() { return <Wave5Workbench spec={civilTools[5]} group="civil" />; }