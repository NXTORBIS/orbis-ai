import { Radio } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { electricalTools } from '@jarvis/components/toolkit/science50/electrical';
export default function LineVSWR() { return <EngineeringCalculator spec={electricalTools.vswr} icon={Radio} />; }