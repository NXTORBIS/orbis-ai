import Wave14Workbench from '@jarvis/components/toolkit/wave14/Wave14Workbench';
import { coffeeTools } from '@jarvis/components/toolkit/wave14/coffee';
export default function BrewWaterMinerals(){return <Wave14Workbench spec={coffeeTools.find((t)=>t.id==='brew-water-minerals')} group="coffee" />;}