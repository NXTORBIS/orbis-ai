import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { ceramicsTools } from '@jarvis/components/toolkit/wave12/ceramics';
export default function KilnFiringHeatWork(){return <Wave12Workbench spec={ceramicsTools.find((t)=>t.id==='kiln-firing-heat-work')} group="ceramics" />;}