import { Zap } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { electricalTools } from '@jarvis/components/toolkit/science50/electrical';
export default function SkinDepth() { return <EngineeringCalculator spec={electricalTools.skin} icon={Zap} />; }