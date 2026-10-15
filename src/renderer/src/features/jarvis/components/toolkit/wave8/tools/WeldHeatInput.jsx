import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { weldingTools } from '@jarvis/components/toolkit/wave8/welding';
export default function WeldHeatInput(){return <Wave8Workbench spec={weldingTools[0]} group="welding" />;}