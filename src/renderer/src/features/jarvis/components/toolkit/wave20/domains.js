import { petroleumTools } from '@jarvis/components/toolkit/wave20/petroleum';
import { miningTools } from '@jarvis/components/toolkit/wave20/mining';
import { propertyTools } from '@jarvis/components/toolkit/wave20/property';
import { libraryTools } from '@jarvis/components/toolkit/wave20/library';
import { garmentTools } from '@jarvis/components/toolkit/wave20/garment';
import { winterTools } from '@jarvis/components/toolkit/wave20/winter';
import { groundopsTools } from '@jarvis/components/toolkit/wave20/groundops';
import { facilityTools } from '@jarvis/components/toolkit/wave20/facility';

export const DOMAIN_TOOLS = {
  petroleum: petroleumTools,
  mining: miningTools,
  property: propertyTools,
  library: libraryTools,
  garment: garmentTools,
  winter: winterTools,
  groundops: groundopsTools,
  facility: facilityTools,
};

export const toolsOf = (group) => DOMAIN_TOOLS[group] ?? [];