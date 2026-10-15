import { createElement, lazy } from 'react';
import definitions from '@jarvis/components/toolkit/wave18/definitions';
import { icons } from '@jarvis/components/toolkit/wave18/icons';

const Tool = lazy(() => import('@jarvis/components/toolkit/wave18/Wave18Tool'));

export default definitions.map((group) => ({
  id: `wave18-${group.id}`,
  label: group.label,
  icon: icons[group.id],
  tools: group.tools.map(([id, label, desc]) => ({
    id,
    label,
    desc,
    icon: icons[group.id],
    isNew: true,
    component: () => createElement(Tool, { id, group: group.id }),
  })),
}));