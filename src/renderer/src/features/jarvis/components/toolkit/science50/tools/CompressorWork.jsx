import { Gauge } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { thermalTools } from '@jarvis/components/toolkit/science50/thermal';
export default function CompressorWork() { return <EngineeringCalculator spec={thermalTools.compressor} icon={Gauge} />; }