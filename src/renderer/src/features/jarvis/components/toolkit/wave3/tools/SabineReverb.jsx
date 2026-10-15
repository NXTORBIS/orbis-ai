import { Volume2 } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { acousticsTools } from '@jarvis/components/toolkit/wave3/acoustics3';
export default function SabineReverb(){return <Wave3Workbench spec={acousticsTools[0]} icon={Volume2} />;}