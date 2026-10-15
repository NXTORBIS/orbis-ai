import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function ChromaticDispersion(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='chromatic-dispersion')} group="fibre" />;}