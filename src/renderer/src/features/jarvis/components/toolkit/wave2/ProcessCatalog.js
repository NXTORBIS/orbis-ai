import { lazy } from 'react';
import { Gauge } from 'lucide-react';
const tools=[
 ['vacuum-pumpdown','Vacuum Pump-Down Planner','Vessel evacuation pressure, pumping throughput and time to target vacuum.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/VacuumPumpdown'))],
 ['molecular-conductance','Molecular-Flow Vacuum Line','Long-tube conductance, effective pumping speed and Knudsen regime checks.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/MolecularConductance'))],
 ['vacuum-rise-gas-load','Vacuum Rate-of-Rise Gas Load','Isolated pressure-rise measurement into total leak and outgassing load.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/VacuumRiseGasLoad'))],
 ['gas-mixture-flow','Two-Stream Gas Mixing','Standard gas flow, target component fraction and molar delivery balance.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/GasMixtureFlow'))],
 ['rotameter-correction','Rotameter Gas Correction','Variable-area flowmeter readings corrected for gas density, pressure and temperature.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/RotameterCorrection'))],
 ['knudsen-diffusion','Porous Knudsen Diffusion','Wall collisions, molecular transport, porosity and Bosanquet diffusivity.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/KnudsenDiffusion'))],
 ['darcy-permeability-flow','Darcy Porous-Medium Flow','Intrinsic permeability and pressure gradient into seepage rate and hydraulic power.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/DarcyPermeabilityFlow'))],
 ['gas-linepack','Isothermal Gas Line-Pack','Compressed pipeline gas inventory, usable mass and standard volume.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/GasLinepack'))],
 ['reverse-osmosis-drive','Reverse Osmosis Driving Pressure','Hydraulic versus osmotic pressure, membrane water flux and signed flow.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ReverseOsmosisDrive'))],
 ['gas-purge-planner','Mixed-Vessel Gas Purge Planner','Tracer dilution, required volume exchanges and ideal purge duration.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/GasPurgePlanner'))]
];
export default {id:'wave2-process',label:'Vacuum & Process Design',icon:Gauge,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Gauge,isNew:true}))};