import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { acoustestTools } from '@jarvis/components/toolkit/wave8/acoustest';
export default function ShockResponseSpectrum(){return <Wave8Workbench spec={acoustestTools[3]} group="acoustest" />;}