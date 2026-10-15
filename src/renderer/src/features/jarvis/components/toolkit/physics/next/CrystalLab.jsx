import { Grid3x3 } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import CrystalView from '@jarvis/components/toolkit/physics/next/CrystalView';
import { crystalSim } from '@jarvis/components/toolkit/physics/next/crystalCore';

export default function CrystalLab() {
  return <LabWorkbench sim={crystalSim} title="Crystal Diffraction Laboratory" icon={Grid3x3} desc="Generate cubic powder X-ray patterns, inspect Miller planes and systematic absences, and see size, strain and instrument broadening change each peak.">
    {(props) => <CrystalView {...props} />}
  </LabWorkbench>;
}