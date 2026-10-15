import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { weldingTools } from '@jarvis/components/toolkit/wave8/welding';
export default function WeldShrinkage(){return <Wave8Workbench spec={weldingTools[6]} group="welding" />;}