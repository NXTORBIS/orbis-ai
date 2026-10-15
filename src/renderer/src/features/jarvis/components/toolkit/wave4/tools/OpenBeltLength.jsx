import { Cog } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { manufacturingTools } from '@jarvis/components/toolkit/wave4/manufacturing';
export default function OpenBeltLength() { return <Wave3Workbench spec={manufacturingTools[9]} icon={Cog} />; }