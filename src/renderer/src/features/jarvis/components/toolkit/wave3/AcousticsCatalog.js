import { lazy } from 'react';
import { Volume2 } from 'lucide-react';
const tools=[
 ['sabine-reverb','Room Reverberation (Sabine)','Reverberation time, absorption and critical distance from a room’s volume and surfaces.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SabineReverb'))],
 ['sound-transmission-loss','Partition Sound Insulation','Mass-law transmission loss and the level that leaks into the next room.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SoundTransmissionLoss'))],
 ['helmholtz-resonator','Helmholtz Resonator','Tuned frequency of a cavity-and-neck absorber, with flanged and open end corrections.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/HelmholtzResonator'))],
 ['duct-attenuation','Ducted HVAC Attenuation','How much a duct run takes out of a fan’s level before it reaches the room.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/DuctAttenuation'))],
 ['vibration-transmissibility','Vibration Isolation Sizing','Transmissibility through a mount, isolation gained and the deflection it implies.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/VibrationIsolation'))],
 ['beam-mode-frequency','Beam Natural Frequency','Fundamental and second bending mode of a beam, with the static sag that goes with it.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/BeamNaturalFrequency'))],
 ['damped-free-decay','Damping from a Decay Trace','Logarithmic decrement, damping ratio and quality factor from two decay peaks.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/DampedDecay'))],
 ['band-level-summation','Octave-Band Level Summation','Band levels summed into an overall level, with A and C weighting applied band by band.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/BandLevelSum'))],
 ['underwater-sonar','Sonar Equation Solver','Transmission loss, signal excess and the detection range a sonar can expect.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SonarEquation'))],
 ['loudspeaker-enclosure','Loudspeaker Enclosure Sizing','Box volume, tuning and alignment class from a driver’s Thiele–Small parameters.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/LoudspeakerEnclosure'))]
];
export default {id:'wave3-acoustics',label:'Acoustics & Vibration',icon:Volume2,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Volume2,isNew:true}))};