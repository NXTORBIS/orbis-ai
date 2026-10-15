import { Atom } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import NuclearView from '@jarvis/components/toolkit/physics/next/NuclearView';
import { nuclearSim } from '@jarvis/components/toolkit/physics/next/nuclearCore';

export default function NuclearLab() {
  return <LabWorkbench sim={nuclearSim} title="Nuclear Decay & Binding Laboratory" icon={Atom} desc="Watch exponential decay, solve a parent–daughter chain including equal half-lives, measure activity and explore the binding-energy landscape.">
    {(props) => <NuclearView {...props} />}
  </LabWorkbench>;
}