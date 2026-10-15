import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { spaceopsTools } from '@jarvis/components/toolkit/wave10/spaceops';
export default function ThermalEquilibriumSat(){return <Wave10Workbench spec={spaceopsTools.find((t)=>t.id==='thermal-equilibrium-sat')} group="spaceops" />;}