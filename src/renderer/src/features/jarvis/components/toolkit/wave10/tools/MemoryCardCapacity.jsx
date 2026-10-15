import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { photographyTools } from '@jarvis/components/toolkit/wave10/photography';
export default function MemoryCardCapacity(){return <Wave10Workbench spec={photographyTools.find((t)=>t.id==='memory-card-capacity')} group="photography" />;}