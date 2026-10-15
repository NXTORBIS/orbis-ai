import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { poolsTools } from '@jarvis/components/toolkit/wave17/pools';
export default function PoolFilterArea(){return <Wave17Workbench spec={poolsTools.find((t)=>t.id==='pool-filter-area')} group="pools" />;}