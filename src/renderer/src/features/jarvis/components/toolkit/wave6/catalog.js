import { lazy } from 'react';
import { Compass, Gauge, Database, Zap, Sprout, Sun, Sigma, Camera } from 'lucide-react';
import definitions from '@jarvis/components/toolkit/wave6/definitions';
const icons={navigation:Compass,instrument:Gauge,systems:Database,power:Zap,agriculture:Sprout,renewables:Sun,probability:Sigma,imaging:Camera};
const loaders=import.meta.glob('/src/features/jarvis/components/toolkit/wave6/tools/*.jsx');
export default definitions.map(group=>({id:`wave6-${group.id}`,label:group.label,icon:icons[group.id],tools:group.tools.map(([id,label,desc,name])=>({id,label,desc,icon:icons[group.id],isNew:true,component:lazy(loaders[`/src/features/jarvis/components/toolkit/wave6/tools/${name}.jsx`])}))}));