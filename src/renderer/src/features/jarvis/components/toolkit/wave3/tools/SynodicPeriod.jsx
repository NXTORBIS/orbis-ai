import { Orbit } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { orbitalTools } from '@jarvis/components/toolkit/wave3/orbital3';
export default function SynodicPeriod(){return <Wave3Workbench spec={orbitalTools[5]} icon={Orbit} />;}