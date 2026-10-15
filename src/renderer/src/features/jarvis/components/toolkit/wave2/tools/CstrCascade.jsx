import { FlaskConical } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { bioprocessTools } from '@jarvis/components/toolkit/wave2/bioprocess';
export default function CstrCascade(){return <WaveWorkbench spec={bioprocessTools[2]} icon={FlaskConical} />;}