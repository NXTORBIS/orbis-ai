import { Droplets } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import FluidView from '@jarvis/components/toolkit/physics/next/FluidView';
import { fluidSim } from '@jarvis/components/toolkit/physics/next/fluidCore';

export default function FluidLab() {
  return <LabWorkbench sim={fluidSim} title="Fluid Dynamics Laboratory" icon={Droplets} desc="Explore a Venturi pressure balance, solve turbulent pipe friction and pump power, or watch a tank drain using the changing hydrostatic head.">
    {(props) => <FluidView {...props} />}
  </LabWorkbench>;
}