import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { divingTools } from '@jarvis/components/toolkit/wave12/diving';
export default function TankFillVolumeGas(){return <Wave12Workbench spec={divingTools.find((t)=>t.id==='tank-fill-volume-gas')} group="diving" />;}