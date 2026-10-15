import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { avalancheTools } from '@jarvis/components/toolkit/wave15/avalanche';
export default function AvalancheSolarLoad(){return <Wave15Workbench spec={avalancheTools.find((t)=>t.id==='avalanche-solar-load')} group="avalanche" />;}