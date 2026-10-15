import { lazy } from 'react';
import { Gauge } from 'lucide-react';
const entries = [
  ['mohr-plane-stress','Mohr Circle & Plane Stress','Principal stresses, rotated plane stresses, maximum shear and von Mises stress.',() => import('@jarvis/components/toolkit/science50/tools/MohrStress')],
  ['euler-column-buckling','Euler Column Buckling','Elastic column buckling load, effective lengths, end conditions and slenderness.',() => import('@jarvis/components/toolkit/science50/tools/ColumnBuckling')],
  ['shaft-torsion-twist','Shaft Torsion & Twist','Solid or hollow shaft shear, angular twist and strain energy.',() => import('@jarvis/components/toolkit/science50/tools/ShaftTorsion')],
  ['thin-wall-pressure-vessel','Thin-Wall Pressure Vessel','Cylinder and sphere membrane hoop stress and allowable pressure.',() => import('@jarvis/components/toolkit/science50/tools/PressureVessel')],
  ['lame-thick-cylinder','Thick-Wall Cylinder — Lamé','Internal/external pressure, radial and hoop stress in thick cylinders.',() => import('@jarvis/components/toolkit/science50/tools/ThickCylinder')],
  ['hertz-sphere-contact','Hertz Sphere–Plane Contact','Elastic contact area, pressure and indentation under a sphere.',() => import('@jarvis/components/toolkit/science50/tools/HertzContact')],
  ['bearing-l10-life','Bearing L10 Life','Ball/roller dynamic load rating life in hours and revolutions.',() => import('@jarvis/components/toolkit/science50/tools/BearingLife')],
  ['goodman-fatigue-safety','Goodman Fatigue Safety','Mean/alternating stress, endurance limit and fatigue safety factor.',() => import('@jarvis/components/toolkit/science50/tools/FatigueGoodman')],
  ['fracture-stress-intensity','Fracture Stress Intensity','Mode-I fracture toughness, stress intensity and critical crack dimensions.',() => import('@jarvis/components/toolkit/science50/tools/FractureIntensity')],
  ['fillet-weld-throat-capacity','Fillet Weld Throat Capacity','Effective fillet throat area and uniform direct shear capacity.',() => import('@jarvis/components/toolkit/science50/tools/WeldCapacity')],
];
export default { id:'engineering-mechanics',label:'Mechanics & Materials',icon:Gauge,tools:entries.map(([id,label,desc,loader])=>({id,label,desc,icon:Gauge,component:lazy(loader),isNew:true})) };