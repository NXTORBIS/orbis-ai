import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { freightTools } from '@jarvis/components/toolkit/wave11/freight';
export default function FuelSurcharge(){return <Wave11Workbench spec={freightTools.find((t)=>t.id==='fuel-surcharge')} group="freight" />;}