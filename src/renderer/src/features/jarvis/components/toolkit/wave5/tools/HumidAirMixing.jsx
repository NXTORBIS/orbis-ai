import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { climateTools } from '@jarvis/components/toolkit/wave5/climate';
export default function HumidAirMixing() { return <Wave5Workbench spec={climateTools[4]} group="climate" />; }