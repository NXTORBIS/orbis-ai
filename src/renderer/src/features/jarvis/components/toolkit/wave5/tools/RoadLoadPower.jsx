import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { vehicleTools } from '@jarvis/components/toolkit/wave5/vehicle';
export default function RoadLoadPower() { return <Wave5Workbench spec={vehicleTools[2]} group="vehicle" />; }