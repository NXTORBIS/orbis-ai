import { Droplets } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { hydroTools } from '@jarvis/components/toolkit/wave3/hydro3';
export default function SolarPvYield(){return <Wave3Workbench spec={hydroTools[1]} icon={Droplets} />;}