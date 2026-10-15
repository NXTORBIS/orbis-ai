import Wave8Workbench from '@jarvis/components/toolkit/wave8/Wave8Workbench';
import { geotechTools } from '@jarvis/components/toolkit/wave8/geotech';
export default function BearingEffectiveWidth(){return <Wave8Workbench spec={geotechTools[6]} group="geotech" />;}