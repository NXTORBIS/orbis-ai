import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { spaceopsTools } from '@jarvis/components/toolkit/wave10/spaceops';
export default function BatteryDodOrbit(){return <Wave10Workbench spec={spaceopsTools.find((t)=>t.id==='battery-dod-orbit')} group="spaceops" />;}