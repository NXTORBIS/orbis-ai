import { lazy } from 'react';
import { Flame } from 'lucide-react';
const entries = [
  ['composite-wall-conduction','Composite Wall Conduction','Multilayer wall thermal resistance, heat flux and interface temperatures.',()=>import('@jarvis/components/toolkit/science50/tools/CompositeWall')],
  ['cylindrical-insulation-critical-radius','Cylindrical Insulation & Critical Radius','Insulated pipe conduction/convection and critical outer radius.',()=>import('@jarvis/components/toolkit/science50/tools/CylinderInsulation')],
  ['heat-exchanger-lmtd','Heat Exchanger LMTD','Log-mean temperature difference and heat duty for counter/parallel flow.',()=>import('@jarvis/components/toolkit/science50/tools/HeatExchangerLMTD')],
  ['heat-exchanger-effectiveness-ntu','Heat Exchanger Effectiveness–NTU','Conductance, heat-capacity ratios, effectiveness and outlet temperatures.',()=>import('@jarvis/components/toolkit/science50/tools/HeatExchangerNTU')],
  ['rectangular-fin-efficiency','Rectangular Fin Heat Transfer','Adiabatic-tip fin efficiency and heat dissipation.',()=>import('@jarvis/components/toolkit/science50/tools/FinEfficiency')],
  ['lumped-thermal-cooling','Lumped Thermal Cooling','Newton cooling curve, thermal time constant and Biot validity.',()=>import('@jarvis/components/toolkit/science50/tools/LumpedCooling')],
  ['thermal-expansion-restraint','Thermal Expansion & Restraint','Free expansion, thermal strain and fully constrained elastic stress.',()=>import('@jarvis/components/toolkit/science50/tools/ThermalExpansion')],
  ['psychrometric-humidity-ratio','Psychrometric Humidity Ratio','Relative humidity, dew point, vapour pressure and moist-air enthalpy.',()=>import('@jarvis/components/toolkit/science50/tools/Psychrometrics')],
  ['isentropic-compressor-work','Isentropic Air Compressor Work','Gas compression temperature, pressure ratio and shaft power.',()=>import('@jarvis/components/toolkit/science50/tools/CompressorWork')],
  ['cooling-tower-approach-range','Cooling Tower Approach & Range','Cooling-water duty, wet-bulb approach and tower effectiveness.',()=>import('@jarvis/components/toolkit/science50/tools/CoolingTower')],
];
export default { id:'thermal-process-tools',label:'Heat & Thermal Processes',icon:Flame,tools:entries.map(([id,label,desc,loader])=>({id,label,desc,icon:Flame,component:lazy(loader),isNew:true})) };