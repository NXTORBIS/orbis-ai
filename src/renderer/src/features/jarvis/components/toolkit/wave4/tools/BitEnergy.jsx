import { Radio } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { radioTools } from '@jarvis/components/toolkit/wave4/radio';
export default function BitEnergy() { return <Wave3Workbench spec={radioTools[6]} icon={Radio} />; }