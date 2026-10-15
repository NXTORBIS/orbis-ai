import { Gauge } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { processTools } from '@jarvis/components/toolkit/wave2/process';
export default function GasMixtureFlow(){return <WaveWorkbench spec={processTools[3]} icon={Gauge} />;}