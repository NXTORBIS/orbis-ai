import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function AttenuationReach(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='attenuation-reach')} group="fibre" />;}