import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { bookbindingTools } from '@jarvis/components/toolkit/wave17/bookbinding';
export default function BookBatchCost(){return <Wave17Workbench spec={bookbindingTools.find((t)=>t.id==='book-batch-cost')} group="bookbinding" />;}