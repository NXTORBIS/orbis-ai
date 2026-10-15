import { Droplets } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function CoolingTower() { return <EngineeringCalculator spec={thermalTools.tower} icon={Droplets} />; }