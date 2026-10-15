import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { reefTools } from '@jarvis/components/toolkit/wave15/reef';
export default function ReefKalkwasserTopoff(){return <Wave15Workbench spec={reefTools.find((t)=>t.id==='reef-kalkwasser-topoff')} group="reef" />;}