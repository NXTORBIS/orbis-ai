import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { fisheriesTools } from '@jarvis/components/toolkit/wave13/fisheries';
export default function VonbertalanffyGrowth(){return <Wave13Workbench spec={fisheriesTools.find((t)=>t.id==='vonbertalanffy-growth')} group="fisheries" />;}