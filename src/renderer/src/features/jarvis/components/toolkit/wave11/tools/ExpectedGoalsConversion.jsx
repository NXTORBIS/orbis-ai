import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { analyticsTools } from '@jarvis/components/toolkit/wave11/analytics';
export default function ExpectedGoalsConversion(){return <Wave11Workbench spec={analyticsTools.find((t)=>t.id==='expected-goals-conversion')} group="analytics" />;}