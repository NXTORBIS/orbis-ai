import { Ruler } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { structureTools } from '@jarvis/components/toolkit/wave3/structure3';
export default function SimplySupportedBeam(){return <Wave3Workbench spec={structureTools[0]} icon={Ruler} />;}