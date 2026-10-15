import { lazy } from 'react';
import { Orbit } from 'lucide-react';
const tools=[
 ['orbital-circular','Circular Orbit Calculator','Orbital speed, period, energy and escape speed for a circular orbit.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CircularOrbit'))],
 ['hohmann-transfer','Hohmann Transfer Planner','Both engine burns, the transfer time and the total Δv between orbits.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/HohmannTransfer'))],
 ['vis-viva-velocity','Elliptical Orbit Velocities','Perigee and apogee speeds, semi-major axis, eccentricity and period.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/EllipticalOrbit'))],
 ['rocket-equation','Rocket Equation & Staging','Δv from propellant mass and exhaust velocity, and the cost of extra Δv.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/RocketEquation'))],
 ['escape-velocity','Escape Velocity & Surface Gravity','Escape speed, circular speed and surface gravity for any mass and radius.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/EscapeVelocity'))],
 ['synodic-period','Synodic Period & Launch Windows','How often two planets line up again and how fast the geometry drifts.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SynodicPeriod'))],
 ['insolation-flux','Insolation & Equilibrium Temperature','Solar flux at any distance and the temperature a body settles at.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/InsolationFlux'))],
 ['magnitude-distance','Magnitude & Distance Modulus','Absolute magnitude, distance modulus and luminosity from brightness.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/MagnitudeDistance'))],
 ['telescope-resolution','Telescope Resolution & Sampling','Diffraction limit, plate scale, pixel sampling and atmospheric seeing.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/TelescopeResolution'))],
 ['hill-sphere','Hill Sphere & Satellite Stability','How far a moon can orbit and the tidal field across the body.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/HillSphere'))]
];
export default {id:'wave3-orbital',label:'Astronomy & Orbital',icon:Orbit,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Orbit,isNew:true}))};