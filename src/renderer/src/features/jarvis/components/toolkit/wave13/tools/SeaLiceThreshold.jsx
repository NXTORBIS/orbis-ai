import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { fisheriesTools } from '@jarvis/components/toolkit/wave13/fisheries';
export default function SeaLiceThreshold(){return <Wave13Workbench spec={fisheriesTools.find((t)=>t.id==='sea-lice-threshold')} group="fisheries" />;}