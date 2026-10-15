import { lazy } from 'react';
import { Flame, Lightbulb, Gauge, Snowflake, Shirt, Pill, Mountain, Ear } from 'lucide-react';
import definitions from '@jarvis/components/toolkit/wave8/definitions';

const icons = { welding: Flame, lighting: Lightbulb, fluidpower: Gauge, cryogenics: Snowflake, textile: Shirt, pharma: Pill, geotech: Mountain, acoustest: Ear };
const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave8/tools/*.jsx');
const screen = (id) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

export default definitions.map((group) => ({
  id: `wave8-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: lazy(loaders[`/src/features/jarvis/components/toolkit/wave8/tools/${screen(id)}.jsx`]),
  })),
}));