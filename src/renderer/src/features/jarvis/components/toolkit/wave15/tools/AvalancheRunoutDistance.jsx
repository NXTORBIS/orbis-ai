import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { avalancheTools } from '@jarvis/components/toolkit/wave15/avalanche';
export default function AvalancheRunoutDistance(){return <Wave15Workbench spec={avalancheTools.find((t)=>t.id==='avalanche-runout-distance')} group="avalanche" />;}