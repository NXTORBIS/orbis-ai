import { Droplets } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { flowTools } from '@jarvis/components/toolkit/science50/flow';
export default function ErgunBed() { return <EngineeringCalculator spec={flowTools.ergun} icon={Droplets} />; }