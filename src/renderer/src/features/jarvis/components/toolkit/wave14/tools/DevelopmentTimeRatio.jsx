import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { coffeeTools } from '@jarvis/components/toolkit/wave14/coffee';
export default function DevelopmentTimeRatio(){return <Wave14Workbench spec={coffeeTools.find((t)=>t.id==='development-time-ratio')} group="coffee" />;}