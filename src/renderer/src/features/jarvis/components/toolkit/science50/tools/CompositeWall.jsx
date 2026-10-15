import { Flame } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function CompositeWall() { return <EngineeringCalculator spec={thermalTools.wall} icon={Flame} />; }