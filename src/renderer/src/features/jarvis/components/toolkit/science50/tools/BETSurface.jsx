import { FlaskConical } from 'lucide-react';
import EngineeringCalculator from '@jarvis/components/toolkit/science50/EngineeringCalculator';
import { chemistryTools } from '@jarvis/components/toolkit/science50/chemistry';
export default function BETSurface() { return <EngineeringCalculator spec={chemistryTools.bet} icon={FlaskConical} />; }