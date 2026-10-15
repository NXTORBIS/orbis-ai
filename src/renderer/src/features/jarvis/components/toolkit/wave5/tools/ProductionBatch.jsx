import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { businessTools } from '@jarvis/components/toolkit/wave5/business';
export default function ProductionBatch() { return <Wave5Workbench spec={businessTools[1]} group="business" />; }