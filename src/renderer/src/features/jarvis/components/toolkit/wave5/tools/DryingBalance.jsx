import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { materialsTools } from '@jarvis/components/toolkit/wave5/materials';
export default function DryingBalance() { return <Wave5Workbench spec={materialsTools[0]} group="materials" />; }