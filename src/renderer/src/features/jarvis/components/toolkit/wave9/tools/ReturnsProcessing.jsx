import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { warehouseTools } from '@jarvis/components/toolkit/wave9/warehouse';
export default function ReturnsProcessing(){return <Wave9Workbench spec={warehouseTools.find((t)=>t.id==='returns-processing')} group="warehouse" />;}