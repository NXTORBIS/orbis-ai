import { ShieldCheck } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { reliabilityTools } from '@jarvis/components/toolkit/wave2/reliability';
export default function ZeroFailurePlan(){return <WaveWorkbench spec={reliabilityTools[5]} icon={ShieldCheck} />;}