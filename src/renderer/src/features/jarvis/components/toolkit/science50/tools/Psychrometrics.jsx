import { Droplets } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function Psychrometrics() { return <EngineeringCalculator spec={thermalTools.humidity} icon={Droplets} />; }