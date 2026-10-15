import { lazy } from 'react';
import { Snowflake, Car, HardHat, Cpu, Telescope, FlaskConical, Layers, TrendingUp } from 'lucide-react';
import definitions from '@jarvis/components/toolkit/wave5/definitions';
export const icons = { climate:Snowflake, vehicle:Car, civil:HardHat, digital:Cpu, astro:Telescope, analytical:FlaskConical, materials:Layers, business:TrendingUp };
const loaders = import.meta.glob('/src/features/jarvis/components/toolkit/wave5/tools/*.jsx');
export default definitions.map(group => ({ id:`wave5-${group.id}`, label:group.label, icon:icons[group.id], tools:group.tools.map(([id,label,desc,name]) => ({ id, label, desc, icon:icons[group.id], isNew:true, component:lazy(loaders[`/src/features/jarvis/components/toolkit/wave5/tools/${name}.jsx`]) })) }));