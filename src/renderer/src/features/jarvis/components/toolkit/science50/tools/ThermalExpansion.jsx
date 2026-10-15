import { Flame } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function ThermalExpansion() { return <EngineeringCalculator spec={thermalTools.expansion} icon={Flame} />; }