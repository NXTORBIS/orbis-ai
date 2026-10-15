import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { Snowflake, Car, HardHat, Cpu, Telescope, FlaskConical, Layers, TrendingUp } from 'lucide-react';
const icons = { climate:Snowflake, vehicle:Car, civil:HardHat, digital:Cpu, astro:Telescope, analytical:FlaskConical, materials:Layers, business:TrendingUp };
export default function Wave5Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}