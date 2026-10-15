import Wave6Workbench from '@jarvis/components/toolkit/wave6/Wave6Workbench';
import { agricultureTools } from '@jarvis/components/toolkit/wave6/agriculture';
export default function SprinklerRuntime(){return <Wave6Workbench spec={agricultureTools[3]} group="agriculture" />;}