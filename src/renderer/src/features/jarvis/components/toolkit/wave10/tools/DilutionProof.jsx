import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { brewingTools } from '@jarvis/components/toolkit/wave10/brewing';
export default function DilutionProof(){return <Wave10Workbench spec={brewingTools.find((t)=>t.id==='dilution-proof')} group="brewing" />;}