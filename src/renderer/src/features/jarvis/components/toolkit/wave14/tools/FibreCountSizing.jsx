import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function FibreCountSizing(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='fibre-count-sizing')} group="fibre" />;}