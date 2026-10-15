import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { geotechTools } from '@jarvis/components/toolkit/wave8/geotech';
export default function PlateLoadModulus(){return <Wave8Workbench spec={geotechTools[1]} group="geotech" />;}