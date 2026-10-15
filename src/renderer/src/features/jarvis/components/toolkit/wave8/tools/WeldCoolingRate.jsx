import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { weldingTools } from '@jarvis/components/toolkit/wave8/welding';
export default function WeldCoolingRate(){return <Wave8Workbench spec={weldingTools[1]} group="welding" />;}