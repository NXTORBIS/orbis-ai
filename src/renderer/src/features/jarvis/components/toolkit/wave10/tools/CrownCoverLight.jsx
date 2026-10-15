import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { forestryTools } from '@jarvis/components/toolkit/wave10/forestry';
export default function CrownCoverLight(){return <Wave10Workbench spec={forestryTools.find((t)=>t.id==='crown-cover-light')} group="forestry" />;}