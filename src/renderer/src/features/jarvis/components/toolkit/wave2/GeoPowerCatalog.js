import { lazy } from 'react';
import { Construction } from 'lucide-react';
const tools=[
 ['rankine-earth-pressure','Rankine Retaining-Wall Pressure','Active/passive earth-pressure coefficients, wall thrust and uniform surcharge.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/RankineEarthPressure'))],
 ['strip-footing-capacity','Strip Footing Bearing Capacity','Vesic bearing factors, ultimate gross pressure and net-based allowable loading.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/StripFootingCapacity'))],
 ['infinite-slope-safety','Infinite Slope Safety Factor','Cohesive frictional slope resistance, pore pressure and effective stress.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/InfiniteSlopeSafety'))],
 ['consolidation-settlement','Clay Consolidation Settlement','Normally consolidated clay settlement and single/double-drainage t90 time.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ConsolidationSettlement'))],
 ['soil-phase-relationships','Soil Compaction Phase Calculator','Wet and dry density, gravimetric moisture, voids, porosity and saturation.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/SoilPhaseRelationships'))],
 ['three-phase-power','Three-Phase Power Triangle','Balanced RMS line current, efficiency, kVA and reactive power.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ThreePhasePower'))],
 ['power-factor-correction','Power-Factor Correction Bank','Lagging power factor correction and per-phase star/delta capacitor sizing.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/PowerFactorCorrection'))],
 ['transformer-fault-current','Transformer Prospective Fault Current','Balanced bolted terminal faults from transformer and upstream per-unit impedance.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/TransformerFaultCurrent'))],
 ['symmetrical-components','Symmetrical Phasor Components','Fortescue positive, negative and zero sequence plus voltage unbalance.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/SymmetricalComponents'))],
 ['battery-pack-topology','Battery Pack Topology & Loading','Series/parallel cells, energy, current sharing and internal-resistance voltage droop.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/BatteryPackTopology'))]
];
export default {id:'wave2-geopower',label:'Geotechnics & Power',icon:Construction,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Construction,isNew:true}))};