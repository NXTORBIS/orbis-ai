import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { paperTools } from '@jarvis/components/toolkit/wave13/paper';
export default function MachineOutput(){return <Wave13Workbench spec={paperTools.find((t)=>t.id==='machine-output')} group="paper" />;}