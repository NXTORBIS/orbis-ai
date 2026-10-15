import { lazy } from 'react';
import { Droplets } from 'lucide-react';
const tools = [
 ['liquid-orifice-meter','Liquid Orifice Flow Meter','Differential pressure, diameter ratio and liquid flow.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/OrificeMeter'))],
 ['v-notch-weir-flow','V-Notch Weir Discharge','Head and triangular-notch angle into free-flow discharge.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/VNotchWeir'))],
 ['hazen-williams-water-pipe','Hazen–Williams Water Pipe Loss','Empirical full-water-pipe friction loss and hydraulic power.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/HazenWilliams'))],
 ['ideal-settling-tank','Ideal Settling Tank Removal','Surface overflow, residence time and particle settling.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/SettlingTank'))],
 ['sand-filter-backwash','Sand Filter Loading & Backwash','Filtration velocity, bed volume and backwash water.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/SandFilter'))],
 ['disinfection-ct-contact','Disinfection CT Contact Estimate','Residual disinfectant and baffled effective contact time.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/DisinfectionCT'))],
 ['uv-reactor-dose','UV Exposure Dose Estimate','Idealized ultraviolet intensity, residence and exposure dose.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/UVDose'))],
 ['langelier-saturation-index','Langelier Saturation Index','Water pH, hardness and alkalinity into carbonate saturation.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/LangelierIndex'))],
 ['carbon-bed-contact','Activated Carbon Bed Contact','Empty-bed and void contact time with carbon media inventory.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/CarbonBed'))],
 ['chlorine-solution-feed','Disinfectant Solution Feed Rate','Active dose, chemical solution strength and volumetric feed.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/SolutionFeed'))]
];
export default { id:'wave4-water', label:'Water Treatment & Process Hydraulics', icon:Droplets, tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Droplets,isNew:true})) };