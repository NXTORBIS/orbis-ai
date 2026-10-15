import { ShieldCheck } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { reliabilityTools } from '@jarvis/components/toolkit/wave2/reliability';
export default function SeriesReliability(){return <WaveWorkbench spec={reliabilityTools[2]} icon={ShieldCheck} />;}