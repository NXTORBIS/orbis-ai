import { lazy } from 'react';
import { Droplets } from 'lucide-react';
const tools=[
 ['rational-runoff','Rational Method Runoff','Peak storm flow, runoff volume and effective rainfall from a catchment.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/RationalRunoff'))],
 ['solar-pv-yield','Solar PV Yield & Payback','Generation, bill savings, carbon avoided and the simple payback period.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SolarPvYield'))],
 ['wind-turbine-power','Wind Turbine Power Curve','Power at a given wind speed, the Betz ceiling and capacity used.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/WindTurbinePower'))],
 ['river-pollutant-decay','River BOD/DO (Streeter–Phelps)','How a pollutant load decays downstream and how far the oxygen sag reaches.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/RiverBodDo'))],
 ['horton-infiltration','Horton Infiltration & Runoff','Infiltration capacity decaying with time and the rainfall that becomes runoff.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/HortonInfiltration'))],
 ['wind-chill-heat-index','Apparent Temperature','Wind chill, heat index and humidex — what the weather actually feels like.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/ApparentTemperature'))],
 ['air-quality-index','Air Quality Index','Sub-indices for PM2.5, PM10, ozone and NO₂, the dominant pollutant and band.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/AirQualityIndex'))],
 ['soil-erosion-usle','Soil Loss (USLE)','Annual soil loss from rainfall, soil, slope, cover and practice factors.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/SoilErosionUsle'))],
 ['evapotranspiration-hargreaves','Reference Evapotranspiration','Reference ET, crop water use and the irrigation a field actually needs.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/ReferenceEvapotranspiration'))],
 ['groundwater-darcy-well','Pumping Well Yield (Thiem)','Well yield, transmissivity and specific capacity from aquifer properties.',lazy(()=>import('@jarvis/components/toolkit/wave3/tools/WellYieldThiem'))]
];
export default {id:'wave3-hydro',label:'Water, Energy & Climate',icon:Droplets,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Droplets,isNew:true}))};