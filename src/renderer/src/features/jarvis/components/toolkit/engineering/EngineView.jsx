import { geometry, pistonFromCrank } from '@jarvis/components/toolkit/engineering/engineCore';

const STAGE_TINT = {
  Intake: 'hsl(210 90% 60% / 0.22)',
  Compression: 'hsl(189 100% 50% / 0.22)',
  Power: 'hsl(38 92% 55% / 0.3)',
  Exhaust: 'hsl(0 0% 60% / 0.22)',
};

/** Cutaway of one cylinder: piston, rod, crank, valves and the gas above the piston. */
export default function EngineView({ readings: r, params }) {
  const g = geometry(params);
  const borePx = 150;
  const scale = borePx / params.bore;
  const strokePx = (2 * g.r) * 1000 * scale;
  const travel = ((g.top - r.piston) * 1000) * scale;
  const topY = 60;
  const pistonY = topY + travel;
  const crankCy = pistonY + strokePx / 2 + 26;
  const crankR = (g.r * 1000) * scale;
  const theta = (r.thetaDeg * Math.PI) / 180;
  const pinX = 110;
  const pinY = crankCy - crankR * Math.cos(theta);
  const crankX = pinX + crankR * Math.sin(theta);
  const heat = Math.min(1, r.pressureBar / 60);

  return (
    <svg viewBox="0 0 520 400" className="w-full rounded-xl bg-background/50" role="img" aria-label="Engine cutaway with piston, connecting rod, crank and valves">
      <rect x={pinX - borePx / 2} y={topY - 34} width={borePx} height={strokePx + 70} rx="8" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
      <rect x={pinX - borePx / 2 + 6} y={topY} width={borePx - 12} height={Math.max(4, pistonY - topY)} fill={heat > 0.35 && r.stage === 'Power' ? 'hsl(38 92% 55% / 0.45)' : STAGE_TINT[r.stage]} />
      <text x={pinX + borePx / 2 + 10} y={topY + 24} fontSize="11" fill="hsl(var(--muted-foreground))">{r.pressureBar.toFixed(2)} bar</text>
      <text x={pinX + borePx / 2 + 10} y={topY + 40} fontSize="11" fill="hsl(var(--muted-foreground))">{r.volumeCc.toFixed(1)} cm³</text>

      {[['intake', -1], ['exhaust', 1]].map(([side, dir]) => {
        const lift = side === 'intake' ? r.intakeLift : r.exhaustLift;
        const open = lift > 0.05;
        const x = pinX + dir * 34;
        const y = topY - 10 + lift * scale * 0.5;
        return (
          <g key={side}>
            <line x1={x} y1={topY - 30} x2={x} y2={y} stroke={open ? 'hsl(189 100% 50%)' : 'hsl(var(--border))'} strokeWidth="4" />
            <polygon points={`${x - 11},${y} ${x + 11},${y} ${x + 5},${y + 9} ${x - 5},${y + 9}`} fill={open ? 'hsl(189 100% 50% / 0.75)' : 'hsl(var(--muted))'} stroke="hsl(var(--border))" />
            <text x={x - 16} y={topY - 38} fontSize="9" fill="hsl(var(--muted-foreground))">{side}</text>
            {open && <line x1={x} y1={topY - 46} x2={x} y2={topY - 20} stroke="hsl(189 100% 50% / 0.6)" strokeWidth="1.5" strokeDasharray="3 3" />}
          </g>
        );
      })}

      {r.stage === 'Power' && r.thetaDeg > 360 - params.advance && r.thetaDeg < 360 - params.advance + 12 && (
        <text x={pinX} y={topY - 6} fontSize="12" textAnchor="middle" fill="hsl(38 92% 55%)">✳ ignition</text>
      )}

      <rect x={pinX - borePx / 2 + 6} y={pistonY} width={borePx - 12} height="22" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--cyan) / 0.7)" strokeWidth="1.5" />
      <line x1={pinX} y1={pistonY + 11} x2={pinX} y2={pinY} stroke="hsl(var(--cyan))" strokeWidth="7" strokeLinecap="round" />
      <circle cx={pinX} cy={pinY} r="5" fill="hsl(var(--foreground))" />
      <circle cx={pinX} cy={crankCy} r="4" fill="hsl(var(--muted-foreground))" />
      <line x1={pinX} y1={crankCy} x2={crankX} y2={pinY - 0} stroke="hsl(38 92% 55%)" strokeWidth="8" strokeLinecap="round" />
      <circle cx={crankX} cy={crankCy + (pinY - crankCy) * 0} r="0" />
      <circle cx={pinX + crankR * Math.sin(theta)} cy={crankCy - crankR * Math.cos(theta)} r="10" fill="hsl(var(--card))" stroke="hsl(38 92% 55%)" strokeWidth="2" />

      <text x={pinX - borePx / 2} y={crankCy + 96} fontSize="12" fill="hsl(var(--foreground))">{r.stage} stroke · crank {r.thetaDeg.toFixed(0)}°</text>
      <text x={pinX - borePx / 2} y={crankCy + 114} fontSize="11" fill="hsl(var(--muted-foreground))">{params.rpm} rpm · piston {r.piston.toFixed(4)} m from the crank axis</text>
      <text x={pinX - borePx / 2} y={crankCy + 132} fontSize="11" fill="hsl(var(--muted-foreground))">intake lift {r.intakeLift.toFixed(2)} mm · exhaust lift {r.exhaustLift.toFixed(2)} mm</text>
      <circle cx={pinX - borePx / 2 + 6} cy={topY + 140} r="0" />
    </svg>
  );
}