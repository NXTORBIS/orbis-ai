import { lazy } from 'react';
import { Anchor, Flame, UtensilsCrossed, Printer, AudioLines, Bot, Package, Pickaxe } from 'lucide-react';
import definitions from '@jarvis/components/toolkit/wave7/definitions';

const icons = { marine: Anchor, firesafety: Flame, food: UtensilsCrossed, print: Printer, audio: AudioLines, robotics: Bot, packaging: Package, mining: Pickaxe };
const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave7/tools/*.jsx');
const screen = (id) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

export default definitions.map((group) => ({
  id: `wave7-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: lazy(loaders[`/src/features/jarvis/components/toolkit/wave7/tools/${screen(id)}.jsx`]),
  })),
}));