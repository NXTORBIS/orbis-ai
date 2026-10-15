import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { archeryTools } from '@jarvis/components/toolkit/wave14/archery';
export default function FocBalancePoint(){return <Wave14Workbench spec={archeryTools.find((t)=>t.id==='foc-balance-point')} group="archery" />;}