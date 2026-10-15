import { Droplets } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { waterTools } from '@jarvis/components/toolkit/wave4/water';
export default function VNotchWeir() { return <Wave3Workbench spec={waterTools[1]} icon={Droplets} />; }