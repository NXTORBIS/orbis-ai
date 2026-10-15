import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { icons } from '@jarvis/components/toolkit/wave12/icons';

export default function Wave12Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}