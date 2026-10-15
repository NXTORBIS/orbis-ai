import Wave7Workbench from '@jarvis/components/toolkit/wave7/Wave7Workbench';
import { marineTools } from '@jarvis/components/toolkit/wave7/marine';
export default function LoadLineFreeboard(){return <Wave7Workbench spec={marineTools[3]} group="marine" />;}