import Wave6Workbench from '@jarvis/components/toolkit/wave6/Wave6Workbench';
import { probabilityTools } from '@jarvis/components/toolkit/wave6/probability';
export default function BetaPosterior(){return <Wave6Workbench spec={probabilityTools[1]} group="probability" />;}