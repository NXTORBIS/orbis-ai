import { Aperture } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { opticsTools } from '@jarvis/components/toolkit/wave3/optics3';
export default function ThinLensStudio(){return <Wave3Workbench spec={opticsTools[0]} icon={Aperture} />;}