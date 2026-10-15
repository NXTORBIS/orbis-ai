import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { leatherTools } from '@jarvis/components/toolkit/wave13/leather';
export default function FatliquorOffer(){return <Wave13Workbench spec={leatherTools.find((t)=>t.id==='fatliquor-offer')} group="leather" />;}