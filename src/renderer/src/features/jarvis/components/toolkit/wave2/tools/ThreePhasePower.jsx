import { Construction } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { geopowerTools } from '@jarvis/components/toolkit/wave2/geopower';
export default function ThreePhasePower(){return <WaveWorkbench spec={geopowerTools[5]} icon={Construction} />;}