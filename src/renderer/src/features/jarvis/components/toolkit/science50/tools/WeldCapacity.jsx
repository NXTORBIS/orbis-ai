import { Wrench } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function WeldCapacity() { return <EngineeringCalculator spec={mechanicalTools.weld} icon={Wrench} />; }