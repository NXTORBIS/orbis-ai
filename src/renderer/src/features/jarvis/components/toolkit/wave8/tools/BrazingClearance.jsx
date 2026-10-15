import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { weldingTools } from '@jarvis/components/toolkit/wave8/welding';
export default function BrazingClearance(){return <Wave8Workbench spec={weldingTools[8]} group="welding" />;}