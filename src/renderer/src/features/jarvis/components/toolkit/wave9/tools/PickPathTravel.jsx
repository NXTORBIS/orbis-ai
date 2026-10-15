import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { warehouseTools } from '@jarvis/components/toolkit/wave9/warehouse';
export default function PickPathTravel(){return <Wave9Workbench spec={warehouseTools.find((t)=>t.id==='pick-path-travel')} group="warehouse" />;}