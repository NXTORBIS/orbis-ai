import { Cog } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { mechanicalTools } from '@jarvis/components/toolkit/science50/mechanical';
export default function HertzContact() { return <EngineeringCalculator spec={mechanicalTools.hertz} icon={Cog} />; }