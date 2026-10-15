import Wave10Workbench from '@jarvis/components/toolkit/wave10/Wave10Workbench';
import { hydroponicsTools } from '@jarvis/components/toolkit/wave10/hydroponics';
export default function NftChannelFlow(){return <Wave10Workbench spec={hydroponicsTools.find((t)=>t.id==='nft-channel-flow')} group="hydroponics" />;}