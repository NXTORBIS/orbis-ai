import { FlaskConical } from 'lucide-react';
import WaveWorkbench from '@jarvis/components/toolkit/wave2/WaveWorkbench';
import { bioprocessTools } from '@jarvis/components/toolkit/wave2/bioprocess';
export default function MembraneDiafiltration(){return <WaveWorkbench spec={bioprocessTools[9]} icon={FlaskConical} />;}