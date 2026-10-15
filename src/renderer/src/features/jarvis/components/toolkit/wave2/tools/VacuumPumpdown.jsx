import { Gauge } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { processTools } from '@jarvis/components/toolkit/wave2/process';
export default function VacuumPumpdown(){return <WaveWorkbench spec={processTools[0]} icon={Gauge} />;}