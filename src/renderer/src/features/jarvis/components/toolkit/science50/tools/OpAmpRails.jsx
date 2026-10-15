import { CircuitBoard } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { electricalTools } from '@jarvis/components/toolkit/science50/electrical';
export default function OpAmpRails() { return <EngineeringCalculator spec={electricalTools.opamp} icon={CircuitBoard} />; }