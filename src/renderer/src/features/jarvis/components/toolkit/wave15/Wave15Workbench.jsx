import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { icons } from '@jarvis/components/toolkit/wave15/icons';

export default function Wave15Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}