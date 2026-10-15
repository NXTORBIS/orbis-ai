import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { paperTools } from '@jarvis/components/toolkit/wave13/paper';
export default function PulpYieldKappa(){return <Wave13Workbench spec={paperTools.find((t)=>t.id==='pulp-yield-kappa')} group="paper" />;}