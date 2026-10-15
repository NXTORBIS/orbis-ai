import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { veterinaryTools } from '@jarvis/components/toolkit/wave9/veterinary';
export default function FecalEggCount(){return <Wave9Workbench spec={veterinaryTools.find((t)=>t.id==='fecal-egg-count')} group="veterinary" />;}