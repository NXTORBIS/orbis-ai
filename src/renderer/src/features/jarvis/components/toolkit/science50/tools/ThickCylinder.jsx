import { Gauge } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function ThickCylinder() { return <EngineeringCalculator spec={mechanicalTools.lame} icon={Gauge} />; }