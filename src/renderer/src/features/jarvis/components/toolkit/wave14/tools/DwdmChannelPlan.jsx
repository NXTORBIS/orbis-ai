import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { fibreTools } from '@jarvis/components/toolkit/wave14/fibre';
export default function DwdmChannelPlan(){return <Wave14Workbench spec={fibreTools.find((t)=>t.id==='dwdm-channel-plan')} group="fibre" />;}