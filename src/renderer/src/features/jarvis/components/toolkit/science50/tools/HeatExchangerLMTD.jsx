import { Flame } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function HeatExchangerLMTD() { return <EngineeringCalculator spec={thermalTools.lmtd} icon={Flame} />; }