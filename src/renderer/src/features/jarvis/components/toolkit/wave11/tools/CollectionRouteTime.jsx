import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { wasteTools } from '@jarvis/components/toolkit/wave11/waste';
export default function CollectionRouteTime(){return <Wave11Workbench spec={wasteTools.find((t)=>t.id==='collection-route-time')} group="waste" />;}