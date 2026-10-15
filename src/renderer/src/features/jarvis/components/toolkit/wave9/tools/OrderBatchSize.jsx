import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { warehouseTools } from '@jarvis/components/toolkit/wave9/warehouse';
export default function OrderBatchSize(){return <Wave9Workbench spec={warehouseTools.find((t)=>t.id==='order-batch-size')} group="warehouse" />;}