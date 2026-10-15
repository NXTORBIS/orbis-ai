import { Binary } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { electricalTools } from '@jarvis/components/toolkit/science50/electrical';
export default function R2RDAC() { return <EngineeringCalculator spec={electricalTools.dac} icon={Binary} />; }