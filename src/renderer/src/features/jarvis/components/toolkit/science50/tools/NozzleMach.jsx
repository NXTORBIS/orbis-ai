import { Wind } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { flowTools } from '@jarvis/components/toolkit/science50/flow';
export default function NozzleMach() { return <EngineeringCalculator spec={flowTools.nozzle} icon={Wind} />; }