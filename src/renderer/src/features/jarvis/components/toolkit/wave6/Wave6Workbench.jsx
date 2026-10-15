import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { Compass, Gauge, Database, Zap, Sprout, Sun, Sigma, Camera } from 'lucide-react';
const icons={navigation:Compass,instrument:Gauge,systems:Database,power:Zap,agriculture:Sprout,renewables:Sun,probability:Sigma,imaging:Camera};
export default function Wave6Workbench({spec,group}) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}