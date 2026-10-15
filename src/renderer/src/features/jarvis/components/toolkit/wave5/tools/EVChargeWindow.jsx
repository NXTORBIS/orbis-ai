import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { vehicleTools } from '@jarvis/components/toolkit/wave5/vehicle';
export default function EVChargeWindow() { return <Wave5Workbench spec={vehicleTools[8]} group="vehicle" />; }