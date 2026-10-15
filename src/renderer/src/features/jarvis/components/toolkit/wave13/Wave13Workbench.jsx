import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { icons } from '@jarvis/components/toolkit/wave13/icons';

export default function Wave13Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}