import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { civilTools } from '@jarvis/components/toolkit/wave5/civil';
export default function PileGroupLoads() { return <Wave5Workbench spec={civilTools[6]} group="civil" />; }