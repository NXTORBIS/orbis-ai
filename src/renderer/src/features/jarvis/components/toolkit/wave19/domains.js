import { robotTools } from '@jarvis/components/toolkit/wave19/robot';
import { waferTools } from '@jarvis/components/toolkit/wave19/wafer';
import { floristTools } from '@jarvis/components/toolkit/wave19/florist';
import { butcherTools } from '@jarvis/components/toolkit/wave19/butcher';
import { physioTools } from '@jarvis/components/toolkit/wave19/physio';
import { windpowerTools } from '@jarvis/components/toolkit/wave19/windpower';
import { locksmithTools } from '@jarvis/components/toolkit/wave19/locksmith';
import { portopsTools } from '@jarvis/components/toolkit/wave19/portops';

export const DOMAIN_TOOLS = {
  robot: robotTools,
  wafer: waferTools,
  florist: floristTools,
  butcher: butcherTools,
  physio: physioTools,
  windpower: windpowerTools,
  locksmith: locksmithTools,
  portops: portopsTools,
};

export const toolsOf = (group) => DOMAIN_TOOLS[group] ?? [];