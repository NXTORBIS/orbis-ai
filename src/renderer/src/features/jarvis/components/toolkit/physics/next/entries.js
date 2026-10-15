import { lazy } from 'react';
import { Clock, Atom, CircuitBoard, Droplets, AudioWaveform, Grid3x3 } from 'lucide-react';

const RelativityLab = lazy(() => import('@jarvis/components/toolkit/physics/next/RelativityLab'));
const NuclearLab = lazy(() => import('@jarvis/components/toolkit/physics/next/NuclearLab'));
const SemiconductorLab = lazy(() => import('@jarvis/components/toolkit/physics/next/SemiconductorLab'));
const FluidLab = lazy(() => import('@jarvis/components/toolkit/physics/next/FluidLab'));
const AcousticLab = lazy(() => import('@jarvis/components/toolkit/physics/next/AcousticLab'));
const CrystalLab = lazy(() => import('@jarvis/components/toolkit/physics/next/CrystalLab'));

const nextPhysicsTools = [
  { id: 'special-relativity', label: 'Special Relativity Laboratory', icon: Clock, component: RelativityLab, isNew: true, desc: 'Einstein Lorentz transformations, moving clocks, length contraction, twin paradox worldlines, relativistic energy and velocity addition with light-speed and interval checks.' },
  { id: 'nuclear-decay-chain', label: 'Nuclear Decay & Binding Laboratory', icon: Atom, component: NuclearLab, isNew: true, desc: 'Radioactivity and nuclear physics: isotope half-lives, becquerel activity, Bateman parent–daughter decay chains, equal-rate limits, mass defects and semi-empirical binding energies.' },
  { id: 'semiconductor-devices', label: 'Semiconductor Devices Laboratory', icon: CircuitBoard, component: SemiconductorLab, isNew: true, desc: 'PN junction diode I–V curves, temperature and series resistance, photovoltaic solar cell maximum-power point and fill factor, and MOSFET transistor cutoff, triode and saturation.' },
  { id: 'fluid-dynamics-lab', label: 'Fluid Dynamics Laboratory', icon: Droplets, component: FluidLab, isNew: true, desc: 'Bernoulli Venturi flow, Reynolds number, laminar and turbulent pipe friction, Colebrook and Darcy–Weisbach pressure loss, pump power and Torricelli tank draining.' },
  { id: 'acoustics-resonance', label: 'Acoustics & Resonance Laboratory', icon: AudioWaveform, component: AcousticLab, isNew: true, desc: 'Sound pressure standing waves in open and closed tubes, audible beat frequencies, harmonics, air temperature, room absorption and Sabine/Eyring RT60 reverberation.' },
  { id: 'crystal-diffraction', label: 'Crystal Diffraction Laboratory', icon: Grid3x3, component: CrystalLab, isNew: true, desc: 'Solid-state cubic crystal powder X-ray diffraction XRD, Bragg angles, Miller indices and planes, BCC/FCC systematic absences, Scherrer crystallite size and microstrain broadening.' },
];
export default nextPhysicsTools;