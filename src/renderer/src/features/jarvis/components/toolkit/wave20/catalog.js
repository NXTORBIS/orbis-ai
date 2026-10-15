import { createElement, lazy } from 'react';
import definitions from '@jarvis/components/toolkit/wave20/definitions';
import { icons } from '@jarvis/components/toolkit/wave20/icons';

const Tool = lazy(() => import('@jarvis/components/toolkit/wave20/Wave20Tool'));

export default definitions.map((group) => ({
  id: `wave20-${group.id}`,
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