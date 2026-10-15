import { FlaskConical } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { bioprocessTools } from '@jarvis/components/toolkit/wave2/bioprocess';
export default function ChemostatWashout(){return <WaveWorkbench spec={bioprocessTools[6]} icon={FlaskConical} />;}