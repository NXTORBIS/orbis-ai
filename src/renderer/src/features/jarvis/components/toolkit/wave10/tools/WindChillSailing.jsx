import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { navigationTools } from '@jarvis/components/toolkit/wave10/navigation';
// The catalogue names this tool 'wind-chill-sailing' while its calculator is written under 'apparent-wind-sailing':
// the file that joins the two was missing in the project this came from, so the tool could never open.
export default function WindChillSailing(){return <Wave10Workbench spec={navigationTools.find((t)=>t.id==='apparent-wind-sailing')} group="navigation" />;}
