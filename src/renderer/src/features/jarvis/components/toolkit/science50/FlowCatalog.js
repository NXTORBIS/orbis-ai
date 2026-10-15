import { lazy } from 'react';
import { Wind } from 'lucide-react';
const entries = [
  ['normal-shock-relations','Normal Shock Relations','Mach number, pressure, density and temperature across a normal shock.',()=>import('@jarvis/components/toolkit/science50/tools/NormalShock')],
  ['oblique-shock-weak-branch','Oblique Shock — Weak Branch','Solve the θ–β–Mach relation and flag detached-shock regimes.',()=>import('@jarvis/components/toolkit/science50/tools/ObliqueShock')],
  ['nozzle-area-mach-solver','Nozzle Area–Mach Solver','Isentropic nozzle area ratio inversion with subsonic/supersonic branches.',()=>import('@jarvis/components/toolkit/science50/tools/NozzleMach')],
  ['compressible-orifice-mass-flow','Compressible Gas Orifice Flow','Choked and subcritical gas discharge through an orifice.',()=>import('@jarvis/components/toolkit/science50/tools/GasOrifice')],
  ['manning-open-channel','Manning Open-Channel Flow','Rectangular channel discharge, roughness, slope and Froude number.',()=>import('@jarvis/components/toolkit/science50/tools/ManningChannel')],
  ['hydraulic-jump-sequent-depth','Hydraulic Jump & Energy Loss','Supercritical conjugate depth and hydraulic-jump energy dissipation.',()=>import('@jarvis/components/toolkit/science50/tools/HydraulicJump')],
  ['water-hammer-surge','Water Hammer Surge','Joukowsky pressure waves, elastic pipe compliance and valve closure time.',()=>import('@jarvis/components/toolkit/science50/tools/WaterHammer')],
  ['stokes-settling-velocity','Stokes Settling & Validity','Sphere terminal settling/rising speed and creeping-flow Reynolds check.',()=>import('@jarvis/components/toolkit/science50/tools/StokesSettling')],
  ['ergun-packed-bed-pressure-loss','Ergun Packed-Bed Pressure Loss','Viscous/inertial bed loss, porosity, particle size and superficial velocity.',()=>import('@jarvis/components/toolkit/science50/tools/ErgunBed')],
  ['capillary-rise-contact-angle','Capillary Rise & Contact Angle','Surface tension, wetting, meniscus pressure and signed capillary height.',()=>import('@jarvis/components/toolkit/science50/tools/CapillaryRise')],
];
export default { id:'flow-aero-tools',label:'Flow & Aerodynamics',icon:Wind,tools:entries.map(([id,label,desc,loader])=>({id,label,desc,icon:Wind,component:lazy(loader),isNew:true})) };