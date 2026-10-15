import { CircuitBoard } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import SemiconductorView from '@jarvis/components/toolkit/physics/next/SemiconductorView';
import { semiconductorSim } from '@jarvis/components/toolkit/physics/next/semiconductorCore';

export default function SemiconductorLab() {
  return <LabWorkbench sim={semiconductorSim} title="Semiconductor Devices Laboratory" icon={CircuitBoard} desc="Trace diode I–V curves with real series-resistance solving, find a solar cell’s maximum-power point and explore nMOS cutoff, triode and saturation.">
    {(props) => <SemiconductorView {...props} />}
  </LabWorkbench>;
}