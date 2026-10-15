import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { businessTools } from '@jarvis/components/toolkit/wave5/business';
export default function LearningCurve() { return <Wave5Workbench spec={businessTools[0]} group="business" />; }