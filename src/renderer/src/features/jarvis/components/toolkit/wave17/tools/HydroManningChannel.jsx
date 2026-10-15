import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { hydrologyTools } from '@jarvis/components/toolkit/wave17/hydrology';
export default function HydroManningChannel(){return <Wave17Workbench spec={hydrologyTools.find((t)=>t.id==='hydro-manning-channel')} group="hydrology" />;}