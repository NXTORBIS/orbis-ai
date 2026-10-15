import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { analyticsTools } from '@jarvis/components/toolkit/wave11/analytics';
export default function MagicNumberClinch(){return <Wave11Workbench spec={analyticsTools.find((t)=>t.id==='magic-number-clinch')} group="analytics" />;}