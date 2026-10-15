import { lazy } from 'react';
import { Plane } from 'lucide-react';
const tools = [
 ['wing-lift-force','Wing Lift & Load Balance','Lift coefficient, dynamic pressure and aircraft weight.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/WingLift'))],
 ['aircraft-drag-polar','Aircraft Drag Polar','Parasite and induced drag, lift-to-drag and aerodynamic power.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/DragPolar'))],
 ['aircraft-stall-speed','Stall & Approach Speed Estimate','Density, mass, wing area and maximum lift coefficient.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/StallSpeed'))],
 ['coordinated-bank-turn','Coordinated Banked Turn','Turn radius, turn rate, bank load and stall multiplier.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BankedTurn'))],
 ['best-glide-polar','Best Glide from a Drag Polar','Optimum CL, best-glide speed and ideal no-wind reach.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BestGlide'))],
 ['excess-power-climb','Excess Power & Climb Rate','Useful excess power into vertical speed and climb gradient.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/ClimbRate'))],
 ['propeller-advance-ratio','Propeller Advance & Tip Speed','Advance ratio, helical propeller tip speed and tip Mach.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/PropellerAdvance'))],
 ['wing-reynolds-number','Wing Reynolds Number','Reference chord, viscosity, flow scale and laminar friction.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/WingReynolds'))],
 ['isa-troposphere','ISA Troposphere Atmosphere','Standard-atmosphere pressure, temperature, density and sound speed.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/ISAAtmosphere'))],
 ['aircraft-wind-triangle','Wind Triangle & Ground Track','Heading and meteorological wind into ground speed and track.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/WindTriangle'))]
];
export default { id:'wave4-aviation', label:'Aerodynamics & Aviation', icon:Plane, tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Plane,isNew:true})) };