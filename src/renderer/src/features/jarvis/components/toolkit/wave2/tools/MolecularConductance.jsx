import { Gauge } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { processTools } from '@jarvis/components/toolkit/wave2/process';
export default function MolecularConductance(){return <WaveWorkbench spec={processTools[1]} icon={Gauge} />;}