import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { forestryTools } from '@jarvis/components/toolkit/wave10/forestry';
export default function TreeSpacingPlanting(){return <Wave10Workbench spec={forestryTools.find((t)=>t.id==='tree-spacing-planting')} group="forestry" />;}