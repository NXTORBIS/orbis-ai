import { Droplets } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { flowTools } from '@jarvis/components/toolkit/science50/flow';
export default function WaterHammer() { return <EngineeringCalculator spec={flowTools.hammer} icon={Droplets} />; }