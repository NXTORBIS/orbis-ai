import { AudioWaveform } from 'lucide-react';
import LabWorkbench from '@jarvis/components/toolkit/physics/next/LabWorkbench';
import AcousticView from '@jarvis/components/toolkit/physics/next/AcousticView';
import { acousticSim } from '@jarvis/components/toolkit/physics/next/acousticCore';

export default function AcousticLab() {
  return <LabWorkbench sim={acousticSim} title="Acoustics & Resonance Laboratory" icon={AudioWaveform} desc="See pressure nodes and antinodes, hear two-tone beats and compare Sabine and Eyring reverberation estimates for your room.">
    {(props) => <AcousticView {...props} />}
  </LabWorkbench>;
}