import Wave5Workbench from '@jarvis/components/toolkit/wave5/Wave5Workbench';
import { astroTools } from '@jarvis/components/toolkit/wave5/astro';
export default function TransitDepth() { return <Wave5Workbench spec={astroTools[0]} group="astro" />; }