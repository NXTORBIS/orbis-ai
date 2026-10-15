import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { coffeeTools } from '@jarvis/components/toolkit/wave14/coffee';
export default function ExtractionYieldCheck(){return <Wave14Workbench spec={coffeeTools.find((t)=>t.id==='extraction-yield-check')} group="coffee" />;}