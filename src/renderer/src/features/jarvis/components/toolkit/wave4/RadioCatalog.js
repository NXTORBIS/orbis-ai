import { lazy } from 'react';
import { Radio } from 'lucide-react';
const tools = [
 ['radio-free-space-link','Free-Space Radio Link Budget','Radio received power, path loss, sensitivity and link margin.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/FreeSpaceLink'))],
 ['radio-horizon','Radio Horizon & Mast Heights','Effective Earth radius, mast height and line-of-sight range.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/RadioHorizon'))],
 ['two-ray-interference','Two-Ray Ground Reflection','Direct and ground-reflected radio paths and interference.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/TwoRayReflection'))],
 ['shannon-channel-capacity','Shannon Channel Capacity','Theoretical bandwidth, SNR and information-rate ceiling.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/ShannonCapacity'))],
 ['monostatic-radar-range','Monostatic Radar Range','Detection range from transmit power, gain and target cross-section.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/RadarRange'))],
 ['radar-doppler-shift','Radar Doppler Velocity','Two-way frequency shift, radial speed and carrier wavelength.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/RadarDoppler'))],
 ['radio-ebn0','Eb/N₀ & Spectral Efficiency','Energy per bit, noise bandwidth and coding margin.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BitEnergy'))],
 ['parabolic-dish-gain','Parabolic Dish Gain','Dish aperture efficiency, microwave gain and beamwidth.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/DishGain'))],
 ['uniform-array-factor','Phased Array Beam Steering','Array factor, beam steering, side lobes and grating lobes.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/PhasedArray'))],
 ['phase-noise-jitter','Phase Noise to RMS Jitter','Flat SSB phase-noise integration and clock timing jitter.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/PhaseJitter'))]
];
export default { id:'wave4-radio', label:'Radio, Radar & Communications', icon:Radio, tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Radio,isNew:true})) };