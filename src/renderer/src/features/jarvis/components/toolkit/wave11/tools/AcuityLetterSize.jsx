import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { optometryTools } from '@jarvis/components/toolkit/wave11/optometry';
export default function AcuityLetterSize(){return <Wave11Workbench spec={optometryTools.find((t)=>t.id==='acuity-letter-size')} group="optometry" />;}