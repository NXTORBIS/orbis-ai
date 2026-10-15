import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { dairyTools } from '@jarvis/components/toolkit/wave12/dairy';
export default function MilkPowderReconstitution(){return <Wave12Workbench spec={dairyTools.find((t)=>t.id==='milk-powder-reconstitution')} group="dairy" />;}