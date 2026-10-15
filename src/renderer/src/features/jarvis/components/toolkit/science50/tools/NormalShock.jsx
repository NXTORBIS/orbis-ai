import { Wind } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { flowTools } from '@jarvis/components/toolkit/science50/flow';
export default function NormalShock() { return <EngineeringCalculator spec={flowTools.normal} icon={Wind} />; }