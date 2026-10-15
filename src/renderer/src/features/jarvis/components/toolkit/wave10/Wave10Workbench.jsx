import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { icons } from '@jarvis/components/toolkit/wave10/icons';

export default function Wave10Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}