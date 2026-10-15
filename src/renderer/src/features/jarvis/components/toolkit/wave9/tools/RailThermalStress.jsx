import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { railTools } from '@jarvis/components/toolkit/wave9/rail';
export default function RailThermalStress(){return <Wave9Workbench spec={railTools.find((t)=>t.id==='rail-thermal-stress')} group="rail" />;}