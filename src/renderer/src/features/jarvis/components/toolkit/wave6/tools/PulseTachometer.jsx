import Wave6Workbench from '@jarvis/components/toolkit/wave6/Wave6Workbench';
import { instrumentTools } from '@jarvis/components/toolkit/wave6/instrument';
export default function PulseTachometer(){return <Wave6Workbench spec={instrumentTools[5]} group="instrument" />;}