import { lazy } from 'react';
import { FlaskConical } from 'lucide-react';
const entries = [
  ['nernst-electrode-potential','Nernst Electrode Potential','Electrochemical reduction potential from activity quotient and temperature.',()=>import('@jarvis/components/toolkit/science50/tools/NernstPotential')],
  ['faraday-electroplating-yield','Faraday Electroplating Yield','Electrolysis charge, deposited mass, plating thickness and efficiency.',()=>import('@jarvis/components/toolkit/science50/tools/Electroplating')],
  ['debye-electrolyte-screening','Debye Electrolyte Screening Length','Ionic strength, dielectric permittivity and electrostatic screening.',()=>import('@jarvis/components/toolkit/science50/tools/DebyeLength')],
  ['fick-diffusion-length-flux','Diffusion Length & Fick Flux','Diffusivity, RMS spread, concentration gradients and signed molar flux.',()=>import('@jarvis/components/toolkit/science50/tools/FickDiffusion')],
  ['osmotic-pressure-membrane-force','Osmotic Pressure & Membrane Force','Van’t Hoff osmotic pressure and ideal membrane-area force.',()=>import('@jarvis/components/toolkit/science50/tools/OsmoticPressure')],
  ['clausius-clapeyron-vapour-pressure','Clausius–Clapeyron Vapour Pressure','Estimate saturation pressure from latent heat and a reference state.',()=>import('@jarvis/components/toolkit/science50/tools/VapourPressure')],
  ['langmuir-adsorption-isotherm','Langmuir Adsorption Isotherm','Gas adsorption monolayer coverage, half-pressure and site loading.',()=>import('@jarvis/components/toolkit/science50/tools/LangmuirAdsorption')],
  ['bet-surface-area','BET Surface Area & Multilayer Adsorption','Specific surface area from STP monolayer volume and BET ideal uptake.',()=>import('@jarvis/components/toolkit/science50/tools/BETSurface')],
  ['van-der-waals-real-gas','Van der Waals Real-Gas Pressure','Attraction/excluded-volume corrections, ideal comparison and compressibility.',()=>import('@jarvis/components/toolkit/science50/tools/RealGas')],
  ['flory-huggins-polymer-mixing','Flory–Huggins Polymer Mixing','Binary polymer mixing free energy, spinodal curvature and critical interaction.',()=>import('@jarvis/components/toolkit/science50/tools/PolymerMixing')],
];
export default { id:'physical-chem-tools',label:'Physical Chemistry',icon:FlaskConical,tools:entries.map(([id,label,desc,loader])=>({id,label,desc,icon:FlaskConical,component:lazy(loader),isNew:true})) };