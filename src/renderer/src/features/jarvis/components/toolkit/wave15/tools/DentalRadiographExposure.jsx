import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { dentalTools } from '@jarvis/components/toolkit/wave15/dental';
export default function DentalRadiographExposure(){return <Wave15Workbench spec={dentalTools.find((t)=>t.id==='dental-radiograph-exposure')} group="dental" />;}