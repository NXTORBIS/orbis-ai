import { SlidersHorizontal } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { controlTools } from '@jarvis/components/toolkit/wave2/controls';
export default function ChargePumpPll(){return <WaveWorkbench spec={controlTools[8]} icon={SlidersHorizontal} />;}