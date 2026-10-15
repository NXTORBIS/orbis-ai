import { Plane } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { aviationTools } from '@jarvis/components/toolkit/wave4/aviation';
export default function WingReynolds() { return <Wave3Workbench spec={aviationTools[7]} icon={Plane} />; }