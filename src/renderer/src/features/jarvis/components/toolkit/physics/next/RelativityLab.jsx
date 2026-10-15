import { Clock } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import RelativityView from '@jarvis/components/toolkit/physics/next/RelativityView';
import { relativitySim } from '@jarvis/components/toolkit/physics/next/relativityCore';

export default function RelativityLab() {
  return <LabWorkbench sim={relativitySim} title="Special Relativity Laboratory" icon={Clock} desc="Compare moving clocks, contract lengths, follow twin worldlines, combine fast velocities and transform events without breaking the speed of light.">
    {(props) => <RelativityView {...props} />}
  </LabWorkbench>;
}