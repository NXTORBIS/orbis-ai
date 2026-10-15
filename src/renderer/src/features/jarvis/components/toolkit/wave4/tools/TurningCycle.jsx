import { Wrench } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { manufacturingTools } from '@jarvis/components/toolkit/wave4/manufacturing';
export default function TurningCycle() { return <Wave3Workbench spec={manufacturingTools[1]} icon={Wrench} />; }