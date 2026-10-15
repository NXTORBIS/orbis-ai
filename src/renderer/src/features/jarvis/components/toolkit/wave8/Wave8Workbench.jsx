import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { Flame, Lightbulb, Gauge, Snowflake, Shirt, Pill, Mountain, Ear } from 'lucide-react';

const icons = { welding: Flame, lighting: Lightbulb, fluidpower: Gauge, cryogenics: Snowflake, textile: Shirt, pharma: Pill, geotech: Mountain, acoustest: Ear };

export default function Wave8Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}