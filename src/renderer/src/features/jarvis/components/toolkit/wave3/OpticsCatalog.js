import { lazy } from 'react';
import { Aperture } from 'lucide-react';
const tools=[
 ['thin-lens-imaging','Thin-Lens Imaging Studio','Where a single thin lens puts the image, how large it is, and whether it is real or virtual.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/ThinLensStudio'))],
 ['gaussian-beam-profile','Gaussian Beam Profile','Waist, Rayleigh range, divergence and the spot size a laser delivers at a distance.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/GaussianBeam'))],
 ['diffraction-grating','Diffraction Grating Designer','Groove spacing, diffraction angle, resolving power and the highest order a grating reaches.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/DiffractionGrating'))],
 ['fiber-link-budget','Fibre Link Budget','Every loss along a fibre span, the power that arrives and the margin you still have.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/FiberLinkBudget'))],
 ['fresnel-reflection','Fresnel Reflection Explorer','Reflectance split into s and p polarisation, with the Brewster and critical angles.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/FresnelReflection'))],
 ['antireflection-stack','Quarter-Wave AR Coating','A single quarter-wave layer, its reflectance dip and the width of the low-reflection band.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/AntireflectionStack'))],
 ['photometry-lux','Radiometric to Photometric','Luminous flux, intensity and the illuminance a source delivers at a distance.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/PhotometryLux'))],
 ['laser-rate-equations','Laser Threshold Calculator','Round-trip loss, threshold gain and the headroom the small-signal gain has.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/LaserThreshold'))],
 ['photodetector-noise','Photodetector Noise & NEP','Shot and thermal noise, signal-to-noise ratio and the noise-equivalent power.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/PhotodetectorNoise'))],
 ['coherence-interferometer','Coherence & Fringe Visibility','Coherence length, fringe visibility and the fringes that fit a path difference.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CoherenceVisibility'))]
];
export default {id:'wave3-optics',label:'Optics & Photonics',icon:Aperture,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Aperture,isNew:true}))};