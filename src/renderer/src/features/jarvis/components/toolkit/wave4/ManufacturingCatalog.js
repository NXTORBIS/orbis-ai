import { lazy } from 'react';
import { Wrench } from 'lucide-react';
const tools = [
 ['milling-chip-load','Milling Chip Load & Removal Rate','Feed per tooth, cutting speed and milling material removal.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/MillingChipLoad'))],
 ['lathe-speed-cycle','Turning Speed & Machining Time','Lathe RPM, feed speed, removal rate and pass duration.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/TurningCycle'))],
 ['drilling-cycle-time','Drilling Cycle Time','Drill surface speed, feed, allowances and batch cutting time.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/DrillingCycle'))],
 ['taylor-tool-life','Taylor Cutting Tool Life','Empirical cutting-tool wear, speed sensitivity and target life.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/TaylorToolLife'))],
 ['turning-surface-finish','Turning Surface Finish','Nose radius, feed marks, theoretical Ra and Rz roughness.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/TurningFinish'))],
 ['sheet-bend-allowance','Sheet Metal Bend Allowance','K factor, neutral radius, bend deduction and flat blank.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BendAllowance'))],
 ['blanking-press-force','Blanking Press Force','Sheet perimeter, shear strength and required press tonnage.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/BlankingForce'))],
 ['assembly-tolerance-stack','Assembly Tolerance Stack','Independent RSS and worst-case dimensional tolerances.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/ToleranceStack'))],
 ['spur-gear-geometry','Spur Gear Geometry','Gear module, tooth counts, pitch diameters and centre distance.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/SpurGearGeometry'))],
 ['open-belt-length','Open Belt Drive Length','Pitch belt length, pulley wrap and tangent span.',lazy(()=>import('@jarvis/components/toolkit/wave4/tools/OpenBeltLength'))]
];
export default { id:'wave4-manufacturing', label:'Machining & Manufacturing', icon:Wrench, tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:Wrench,isNew:true})) };