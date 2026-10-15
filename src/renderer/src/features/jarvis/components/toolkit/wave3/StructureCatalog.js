import { lazy } from 'react';
import { Ruler } from 'lucide-react';
const tools=[
 ['beam-simply-supported','Simply Supported Beam','Deflection, moment, shear and bending stress for a uniformly loaded beam.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SimplySupportedBeam'))],
 ['cantilever-tip-load','Cantilever with Tip Load','Tip deflection, root moment, stress and vibration frequency of a cantilever.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CantileverTipLoad'))],
 ['circular-plate-bending','Circular Plate Under Pressure','Centre deflection and edge stress of a flat circular plate carrying pressure.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CircularPlateBending'))],
 ['torsion-noncircular','Torsion of a Rectangular Shaft','Peak shear stress and twist of a rectangular shaft with section coefficients.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/TorsionRectangular'))],
 ['stress-concentration','Notch Stress Concentration','Elastic Kt, Neuber sensitivity, Kf and the fatigue strength left at a notch.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/NotchStressConcentration'))],
 ['thermal-stress','Restrained Thermal Stress','The stress a restrained member builds up when it cannot expand.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/RestrainedThermalStress'))],
 ['creep-larson-miller','Creep Rupture Life (Larson–Miller)','Rupture life at temperature and stress, plus the 100 000 hour equivalents.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CreepRuptureLife'))],
 ['paris-crack-growth','Fatigue Crack Growth (Paris)','Cycles to grow a crack to a limit, and the growth rate at any crack length.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/ParisCrackGrowth'))],
 ['composite-laminate','Composite Laminate Properties','Longitudinal and transverse stiffness, density and fibre load share.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/CompositeLaminate'))],
 ['bolt-group-eccentric','Eccentric Bolt Group (Elastic Method)','Direct and torsional shear in a bolt group under an offset load.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/EccentricBoltGroup'))]
];
export default {id:'wave3-structures',label:'Structures & Materials',icon:Ruler,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Ruler,isNew:true}))};