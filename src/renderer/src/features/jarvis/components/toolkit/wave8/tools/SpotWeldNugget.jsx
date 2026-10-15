import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { weldingTools } from '@jarvis/components/toolkit/wave8/welding';
export default function SpotWeldNugget(){return <Wave8Workbench spec={weldingTools[7]} group="welding" />;}