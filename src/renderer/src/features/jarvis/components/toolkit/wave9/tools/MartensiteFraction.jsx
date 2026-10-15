import Wave9Workbench from '@jarvis/components/toolkit/wave9/Wave9Workbench';
import { metallurgyTools } from '@jarvis/components/toolkit/wave9/metallurgy';
export default function MartensiteFraction(){return <Wave9Workbench spec={metallurgyTools.find((t)=>t.id==='martensite-fraction')} group="metallurgy" />;}