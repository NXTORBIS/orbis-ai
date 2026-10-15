import Wave13Workbench from '@jarvis/components/toolkit/wave13/Wave13Workbench';
import { pyroTools } from '@jarvis/components/toolkit/wave13/pyro';
export default function MortarRackSpacing(){return <Wave13Workbench spec={pyroTools.find((t)=>t.id==='mortar-rack-spacing')} group="pyro" />;}