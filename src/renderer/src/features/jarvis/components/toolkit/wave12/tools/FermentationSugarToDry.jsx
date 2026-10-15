import Wave12Workbench from '@jarvis/components/toolkit/wave12/Wave12Workbench';
import { wineryTools } from '@jarvis/components/toolkit/wave12/winery';
export default function FermentationSugarToDry(){return <Wave12Workbench spec={wineryTools.find((t)=>t.id==='fermentation-sugar-to-dry')} group="winery" />;}