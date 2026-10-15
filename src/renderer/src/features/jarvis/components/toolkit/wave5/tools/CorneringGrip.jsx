import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { vehicleTools } from '@jarvis/components/toolkit/wave5/vehicle';
export default function CorneringGrip() { return <Wave5Workbench spec={vehicleTools[1]} group="vehicle" />; }