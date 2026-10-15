import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { glazingTools } from '@jarvis/components/toolkit/wave12/glazing';
export default function GlassWindLoad(){return <Wave12Workbench spec={glazingTools.find((t)=>t.id==='glass-wind-load')} group="glazing" />;}