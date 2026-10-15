import { Gauge } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { processTools } from '@jarvis/components/toolkit/wave2/process';
export default function RotameterCorrection(){return <WaveWorkbench spec={processTools[4]} icon={Gauge} />;}