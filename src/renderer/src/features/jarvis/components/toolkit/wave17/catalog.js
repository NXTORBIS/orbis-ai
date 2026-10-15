import { lazy } from 'react';
import definitions from '@jarvis/components/toolkit/wave17/definitions';
import { icons } from '@jarvis/components/toolkit/wave17/icons';

const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave17/tools/*.jsx');
const screen = (id) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

export default definitions.map((group) => ({
  id: `wave17-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: lazy(loaders[`/src/features/jarvis/components/toolkit/wave17/tools/${screen(id)}.jsx`]),
  })),
}));