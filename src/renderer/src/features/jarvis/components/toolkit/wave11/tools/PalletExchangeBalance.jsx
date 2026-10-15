import Wave11Workbench from '@jarvis/components/toolkit/wave11/Wave11Workbench';
import { freightTools } from '@jarvis/components/toolkit/wave11/freight';
export default function PalletExchangeBalance(){return <Wave11Workbench spec={freightTools.find((t)=>t.id==='pallet-exchange-balance')} group="freight" />;}