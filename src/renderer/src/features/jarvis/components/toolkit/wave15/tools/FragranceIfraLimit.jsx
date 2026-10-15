import Wave15Workbench from '@jarvis/components/toolkit/wave15/Wave15Workbench';
import { fragranceTools } from '@jarvis/components/toolkit/wave15/fragrance';
export default function FragranceIfraLimit(){return <Wave15Workbench spec={fragranceTools.find((t)=>t.id==='fragrance-ifra-limit')} group="fragrance" />;}