import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { avalancheTools } from '@jarvis/components/toolkit/wave15/avalanche';
export default function AvalancheTempGradient(){return <Wave15Workbench spec={avalancheTools.find((t)=>t.id==='avalanche-temp-gradient')} group="avalanche" />;}