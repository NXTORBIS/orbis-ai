import { Gauge } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function FractureIntensity() { return <EngineeringCalculator spec={mechanicalTools.fracture} icon={Gauge} />; }