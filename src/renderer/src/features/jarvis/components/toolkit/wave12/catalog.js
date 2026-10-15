import { lazy } from 'react';
import definitions from '@jarvis/components/toolkit/wave12/definitions';
import { icons } from '@jarvis/components/toolkit/wave12/icons';

const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave12/tools/*.jsx');
const screen = (id) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

export default definitions.map((group) => ({
  id: `wave12-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: lazy(loaders[`/src/features/jarvis/components/toolkit/wave12/tools/${screen(id)}.jsx`]),
  })),
}));