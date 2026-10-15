import { Workflow } from 'lucide-react';
import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { operationsTools } from '@jarvis/components/toolkit/wave4/operations';
export default function ErlangBlocking() { return <Wave3Workbench spec={operationsTools[2]} icon={Workflow} />; }