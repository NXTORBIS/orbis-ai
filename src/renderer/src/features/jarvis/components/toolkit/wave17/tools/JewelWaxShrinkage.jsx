import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { jewelleryTools } from '@jarvis/components/toolkit/wave17/jewellery';
export default function JewelWaxShrinkage(){return <Wave17Workbench spec={jewelleryTools.find((t)=>t.id==='jewel-wax-shrinkage')} group="jewellery" />;}