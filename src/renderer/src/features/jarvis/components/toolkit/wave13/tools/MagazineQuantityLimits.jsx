import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { pyroTools } from '@jarvis/components/toolkit/wave13/pyro';
export default function MagazineQuantityLimits(){return <Wave13Workbench spec={pyroTools.find((t)=>t.id==='magazine-quantity-limits')} group="pyro" />;}