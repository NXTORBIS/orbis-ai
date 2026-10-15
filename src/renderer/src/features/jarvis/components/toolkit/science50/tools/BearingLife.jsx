import { Cog } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function BearingLife() { return <EngineeringCalculator spec={mechanicalTools.bearing} icon={Cog} />; }