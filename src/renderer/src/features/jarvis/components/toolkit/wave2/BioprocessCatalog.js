import { lazy } from 'react';
import { FlaskConical } from 'lucide-react';
const tools=[
 ['cstr-conversion','First-Order CSTR Designer','Steady mixed-reactor conversion, residence time and molar production.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/CstrConversion'))],
 ['pfr-conversion','First-Order Plug-Flow Reactor','Ideal tubular reactor conversion, outlet concentration and Damköhler number.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/PfrConversion'))],
 ['cstr-cascade','CSTR Cascade Optimizer','Equal mixed tanks in series against single-tank and plug-flow limits.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/CstrCascade'))],
 ['activation-energy-fit','Two-Temperature Activation Energy','Arrhenius activation energy and pre-exponential factor inferred from two rate measurements.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ActivationEnergyFit'))],
 ['competitive-enzyme','Competitive Enzyme Inhibition','Reversible competitive inhibition, apparent Km and Michaelis–Menten rate.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/CompetitiveEnzyme'))],
 ['monod-growth','Monod Microbial Growth','Substrate-limited growth, endogenous decay, doubling time and uptake.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/MonodGrowth'))],
 ['chemostat-washout','Chemostat Washout Designer','Steady microbial biomass, residual substrate and critical dilution rate.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ChemostatWashout'))],
 ['competitive-binding','Competitive Ligand Binding','Free ligand equilibrium, target occupancy and competing receptor binding.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/CompetitiveBinding'))],
 ['oxygen-transfer','Bioreactor Oxygen Transfer','kLa oxygen transfer, uptake demand, total gas delivery and oxygen limitation.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/OxygenTransfer'))],
 ['membrane-diafiltration','Constant-Volume Diafiltration','Buffer exchange, membrane sieving, solute removal and processing time.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/MembraneDiafiltration'))]
];
export default {id:'wave2-bioprocess',label:'Reactors & Bioengineering',icon:FlaskConical,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:FlaskConical,isNew:true}))};