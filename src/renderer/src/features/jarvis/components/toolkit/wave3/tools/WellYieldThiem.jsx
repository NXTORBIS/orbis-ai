import { Droplets } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { hydroTools } from '@jarvis/components/toolkit/wave3/hydro3';
export default function WellYieldThiem(){return <Wave3Workbench spec={hydroTools[9]} icon={Droplets} />;}