import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { warehouseTools } from '@jarvis/components/toolkit/wave9/warehouse';
export default function SlottingVelocity(){return <Wave9Workbench spec={warehouseTools.find((t)=>t.id==='slotting-velocity')} group="warehouse" />;}