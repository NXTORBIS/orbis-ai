import { Droplets } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { hydroTools } from '@jarvis/components/toolkit/wave3/hydro3';
export default function ReferenceEvapotranspiration(){return <Wave3Workbench spec={hydroTools[8]} icon={Droplets} />;}