import Wave6Workbench from '@jarvis/components/toolkit/wave6/Wave6Workbench';
import { agricultureTools } from '@jarvis/components/toolkit/wave6/agriculture';
export default function CropIrrigation(){return <Wave6Workbench spec={agricultureTools[0]} group="agriculture" />;}