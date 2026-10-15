import { Orbit } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { orbitalTools } from '@jarvis/components/toolkit/wave3/orbital3';
export default function CircularOrbit(){return <Wave3Workbench spec={orbitalTools[0]} icon={Orbit} />;}