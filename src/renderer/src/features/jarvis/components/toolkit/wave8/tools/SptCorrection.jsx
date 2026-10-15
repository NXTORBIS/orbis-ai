import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { geotechTools } from '@jarvis/components/toolkit/wave8/geotech';
export default function SptCorrection(){return <Wave8Workbench spec={geotechTools[0]} group="geotech" />;}