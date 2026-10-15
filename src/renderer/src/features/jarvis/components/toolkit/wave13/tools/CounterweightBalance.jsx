import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { elevatorsTools } from '@jarvis/components/toolkit/wave13/elevators';
export default function CounterweightBalance(){return <Wave13Workbench spec={elevatorsTools.find((t)=>t.id==='counterweight-balance')} group="elevators" />;}