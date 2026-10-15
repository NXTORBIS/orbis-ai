import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { avalancheTools } from '@jarvis/components/toolkit/wave15/avalanche';
export default function AvalancheSlopeAngle(){return <Wave15Workbench spec={avalancheTools.find((t)=>t.id==='avalanche-slope-angle')} group="avalanche" />;}