import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { icons } from '@jarvis/components/toolkit/wave19/icons';
import { toolsOf } from '@jarvis/components/toolkit/wave19/domains';

// One screen serves the whole wave: the catalogue closure passes the tool id and its
// domain, so 120 tools share a single lazily loaded chunk instead of 120 files.
export default function Wave19Tool({ id, group }) {
  const spec = toolsOf(group).find((tool) => tool.id === id);
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}