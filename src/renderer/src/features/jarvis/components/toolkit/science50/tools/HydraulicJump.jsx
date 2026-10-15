import { Droplets } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { flowTools } from '@jarvis/components/toolkit/science50/flow';
export default function HydraulicJump() { return <EngineeringCalculator spec={flowTools.jump} icon={Droplets} />; }