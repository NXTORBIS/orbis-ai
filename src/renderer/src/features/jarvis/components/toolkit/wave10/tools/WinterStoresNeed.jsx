import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { beesTools } from '@jarvis/components/toolkit/wave10/bees';
export default function WinterStoresNeed(){return <Wave10Workbench spec={beesTools.find((t)=>t.id==='winter-stores-need')} group="bees" />;}