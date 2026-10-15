import { lazy } from 'react';
import { ShieldCheck } from 'lucide-react';
const tools=[
 ['weibull-life','Weibull Lifetime Explorer','Survival, hazard, mean life and B10 life with a two-parameter Weibull distribution.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/WeibullLife'))],
 ['lognormal-life','Lognormal Lifetime Explorer','Median life, logarithmic spread, survival probability and lifetime quantiles.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/LognormalLife'))],
 ['series-reliability','Series System Reliability','Independent components that must all survive a mission.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/SeriesReliability'))],
 ['parallel-reliability','Parallel Redundancy Designer','Active parallel branches, residual failure risk and redundancy improvement.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ParallelReliability'))],
 ['voting-reliability','k-of-n Voting Reliability','Quorum and majority-voting reliability with binomial survival probabilities.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/VotingReliability'))],
 ['zero-failure-plan','Zero-Failure Reliability Test Planner','Required mission trials and exact one-sided confidence bounds with zero failures.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ZeroFailurePlan'))],
 ['mtbf-demonstration','Zero-Failure MTBF Demonstration','Operating-hour exposure needed to demonstrate an exponential MTBF target.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/MtbfDemonstration'))],
 ['repair-availability','Repairable System Availability','MTBF, MTTR, annual downtime and transient recovery probability.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/RepairAvailability'))],
 ['process-capability','Process Capability Cp & Cpk','Process centering, specification limits and normally distributed defect estimates.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ProcessCapability'))],
 ['xbar-control-limits','X̄ Statistical Control Limits','Known-sigma subgroup limits, standard error and observed-mean checks.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/XbarControlLimits'))]
];
export default {id:'wave2-reliability',label:'Reliability & Quality',icon:ShieldCheck,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:ShieldCheck,isNew:true}))};