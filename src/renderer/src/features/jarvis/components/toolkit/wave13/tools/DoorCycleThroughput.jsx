import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { elevatorsTools } from '@jarvis/components/toolkit/wave13/elevators';
export default function DoorCycleThroughput(){return <Wave13Workbench spec={elevatorsTools.find((t)=>t.id==='door-cycle-throughput')} group="elevators" />;}