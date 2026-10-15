import { lazy } from 'react';
import { Trophy, Podcast, TrainFront, Warehouse, ShieldCheck, PawPrint, Hammer, ShieldAlert } from 'lucide-react';
import definitions from '@jarvis/components/toolkit/wave9/definitions';

const icons = { sports: Trophy, broadcast: Podcast, rail: TrainFront, warehouse: Warehouse, insurance: ShieldCheck, veterinary: PawPrint, metallurgy: Hammer, cyberops: ShieldAlert };
const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave9/tools/*.jsx');
const screen = (id) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

export default definitions.map((group) => ({
  id: `wave9-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: lazy(loaders[`/src/features/jarvis/components/toolkit/wave9/tools/${screen(id)}.jsx`]),
  })),
}));