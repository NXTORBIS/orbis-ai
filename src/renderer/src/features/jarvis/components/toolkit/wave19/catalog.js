import { createElement, lazy } from 'react';
import definitions from '@jarvis/components/toolkit/wave19/definitions';
import { icons } from '@jarvis/components/toolkit/wave19/icons';

const Tool = lazy(() => import('@jarvis/components/toolkit/wave19/Wave19Tool'));

export default definitions.map((group) => ({
  id: `wave19-${group.id}`,
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