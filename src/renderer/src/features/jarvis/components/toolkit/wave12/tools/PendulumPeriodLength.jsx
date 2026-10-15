import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { horologyTools } from '@jarvis/components/toolkit/wave12/horology';
export default function PendulumPeriodLength(){return <Wave12Workbench spec={horologyTools.find((t)=>t.id==='pendulum-period-length')} group="horology" />;}