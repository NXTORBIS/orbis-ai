import { lazy } from 'react';
import { Workflow } from 'lucide-react';
const tools = [
 ['mm1-queue','Single-Server Queue · M/M/1','Poisson arrivals, utilization, waiting time and queue length.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/SingleServerQueue'))],
 ['mmc-queue','Multi-Server Queue · Erlang C','Pooled servers, delay probability and expected waiting.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/MultiServerQueue'))],
 ['erlang-b-blocking','Erlang B Blocking Capacity','Loss channels, offered traffic and blocking probability.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/ErlangBlocking'))],
 ['little-law-flow','Little’s Law Flow Balance','Work in process, throughput and cycle time.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/LittleLaw'))],
 ['newsvendor-stock','Newsvendor Inventory Quantity','Normal demand and critical service fractile for stock sizing.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/NewsvendorStock'))],
 ['pert-task-estimate','PERT Task Duration Estimate','Three-point scheduling, variance and approximate deadline chance.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/PertDuration'))],
 ['measurement-uncertainty','Measurement Uncertainty Budget','Repeatability, calibration, resolution and expanded uncertainty.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/MeasurementUncertainty'))],
 ['poisson-event-probability','Poisson Event Probability','Exact and cumulative event counts over an observation window.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/PoissonEvents'))],
 ['birthday-collision','Birthday & Identifier Collision','Uniform identifier entropy and exact collision probability.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BirthdayCollision'))],
 ['wilson-proportion-interval','Wilson Proportion Interval','Success rates and bounded two-sided score confidence intervals.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/WilsonInterval'))]
];
export default { id:'wave4-operations', label:'Queues, Operations & Metrology', icon:Workflow, tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Workflow,isNew:true})) };