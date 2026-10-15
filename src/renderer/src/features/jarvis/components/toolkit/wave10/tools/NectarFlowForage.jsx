import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { beesTools } from '@jarvis/components/toolkit/wave10/bees';
export default function NectarFlowForage(){return <Wave10Workbench spec={beesTools.find((t)=>t.id==='nectar-flow-forage')} group="bees" />;}