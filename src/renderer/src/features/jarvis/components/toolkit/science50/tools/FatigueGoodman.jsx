import { Gauge } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function FatigueGoodman() { return <EngineeringCalculator spec={mechanicalTools.goodman} icon={Gauge} />; }