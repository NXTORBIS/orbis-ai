import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { photographyTools } from '@jarvis/components/toolkit/wave10/photography';
export default function StrobeGuideNumber(){return <Wave10Workbench spec={photographyTools.find((t)=>t.id==='strobe-guide-number')} group="photography" />;}