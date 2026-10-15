import { Zap } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { electricalTools } from '@jarvis/components/toolkit/science50/electrical';
export default function BuckSizing() { return <EngineeringCalculator spec={electricalTools.buck} icon={Zap} />; }