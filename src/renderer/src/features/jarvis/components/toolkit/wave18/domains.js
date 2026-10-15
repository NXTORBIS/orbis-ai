import { filmTools } from '@jarvis/components/toolkit/wave18/film';
import { astroobsTools } from '@jarvis/components/toolkit/wave18/astroobs';
import { motorsportTools } from '@jarvis/components/toolkit/wave18/motorsport';
import { turfTools } from '@jarvis/components/toolkit/wave18/turf';
import { wildlifeTools } from '@jarvis/components/toolkit/wave18/wildlife';
import { printmakeTools } from '@jarvis/components/toolkit/wave18/printmake';
import { glassblowTools } from '@jarvis/components/toolkit/wave18/glassblow';
import { eventopsTools } from '@jarvis/components/toolkit/wave18/eventops';

export const DOMAIN_TOOLS = {
  film: filmTools,
  astroobs: astroobsTools,
  motorsport: motorsportTools,
  turf: turfTools,
  wildlife: wildlifeTools,
  printmake: printmakeTools,
  glassblow: glassblowTools,
  eventops: eventopsTools,
};

export const toolsOf = (group) => DOMAIN_TOOLS[group] ?? [];