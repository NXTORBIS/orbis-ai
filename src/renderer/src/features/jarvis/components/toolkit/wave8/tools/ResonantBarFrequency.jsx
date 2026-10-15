import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { acoustestTools } from '@jarvis/components/toolkit/wave8/acoustest';
export default function ResonantBarFrequency(){return <Wave8Workbench spec={acoustestTools[8]} group="acoustest" />;}