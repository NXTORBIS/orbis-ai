import { pumpCurveSamples } from '@jarvis/components/toolkit/engineering/pumpCore';

/** Volute cutaway with the impeller turning and the flow advected through it. */
export default function PumpView({ readings: r, params }) {
  const cx = 190, cy = 145;
  const outletR = 108;
  const eyeR = 26;
  const volute = [];
  for (let i = 0; i <= 90; i += 1) {
    const t = i / 90;
    const angle = t * Math.PI * 1.6;
    const radius = outletR * (0.62 + 0.38 * t);
    volute.push(`${(cx + radius * Math.cos(angle - Math.PI / 2)).toFixed(2)},${(cy + radius * Math.sin(angle - Math.PI / 2)).toFixed(2)}`);
  }
  const point = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  const curves = pumpCurveSamples(params, 24);
  const maxFlow = 2 * params.bep;
  const mapHead = (head) => 236 - (head / Math.max(1, curves[0].pump)) * 88;
  const mapFlow = (flow) => 28 + (flow / maxFlow) * 128;
  const [opx, opy] = [mapFlow(r.flow), mapHead(r.head)];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <svg viewBox="0 0 380 290" className="w-full rounded-xl bg-background/50" role="img" aria-label="Centrifugal pump cutaway with rotating impeller and flow path">
        <polyline points={volute.join(' ')} fill="none" stroke="hsl(var(--border))" strokeWidth="7" strokeLinejoin="round" />
        <polyline points={volute.join(' ')} fill="none" stroke="hsl(var(--cyan) / 0.5)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={outletR * 0.6} fill="hsl(var(--card) / 0.5)" stroke="hsl(var(--border))" />
        <g transform={`rotate(${(r.angle * 180) / Math.PI} ${cx} ${cy})`}>
          {Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2;
            const inner = point(eyeR, a + 0.5);
            const outer = point(outletR * 0.6, a);
            const mid = point((eyeR + outletR * 0.6) / 2, a + 0.6);
            return <path key={i} d={`M ${inner[0]} ${inner[1]} Q ${mid[0]} ${mid[1]} ${outer[0]} ${outer[1]}`} fill="none" stroke="hsl(189 100% 50% / 0.75)" strokeWidth="5" strokeLinecap="round" />;
          })}
        </g>
        {r.r.map((radius, i) => {
          const [x, y] = point(eyeR + radius * (outletR * 0.62 + 34 - eyeR), r.phi[i] - Math.PI / 2);
          return <circle key={i} cx={x} cy={y} r="2.6" fill="hsl(189 100% 62%)" opacity="0.85" />;
        })}
        <circle cx={cx} cy={cy} r={eyeR} fill="hsl(var(--background))" stroke="hsl(var(--cyan) / 0.65)" strokeWidth="1.5" />
        <path d={`M ${cx - 90} ${cy - 14} L ${cx - eyeR} ${cy - 14} L ${cx - eyeR} ${cy + 14} L ${cx - 90} ${cy + 14} Z`} fill="hsl(var(--card) / 0.6)" stroke="hsl(var(--border))" />
        <line x1={cx - 84} y1={cy} x2={cx - eyeR - 4} y2={cy} stroke="hsl(189 100% 50% / 0.7)" strokeWidth="2" markerEnd="url(#pump-arrow)" />
        <text x={cx - 96} y={cy + 30} fontSize="10" fill="hsl(var(--muted-foreground))">suction</text>
        <line x1={cx + 84} y1={cy - 74} x2={cx + 130} y2={cy - 96} stroke="hsl(189 100% 50% / 0.7)" strokeWidth="2" markerEnd="url(#pump-arrow)" />
        <text x={cx + 96} y={cy - 100} fontSize="10" fill="hsl(var(--muted-foreground))">discharge</text>
        <text x="14" y="272" fontSize="10" fill={r.cavitation > 0 ? 'hsl(var(--cyan))' : 'hsl(350 89% 60%)'}>{r.state}</text>
        <defs>
          <marker id="pump-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(189 100% 50%)" /></marker>
        </defs>
      </svg>

      <svg viewBox="0 0 200 270" className="w-full rounded-xl bg-background/50" role="img" aria-label="Pump and system head-flow curves with the operating point">
        <line x1="28" y1="236" x2="170" y2="236" stroke="hsl(var(--border))" />
        <line x1="28" y1="20" x2="28" y2="236" stroke="hsl(var(--border))" />
        <polyline points={curves.map((c) => `${mapFlow(c.flow)},${mapHead(c.pump)}`).join(' ')} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="2" />
        <polyline points={curves.map((c) => `${mapFlow(c.flow)},${mapHead(c.system)}`).join(' ')} fill="none" stroke="hsl(265 85% 68%)" strokeWidth="2" />
        <circle cx={opx} cy={opy} r="4.5" fill="hsl(38 92% 55%)" />
        <text x={opx + 8} y={opy - 6} fontSize="10" fill="hsl(38 92% 55%)">duty point</text>
        <text x="34" y="18" fontSize="10" fill="hsl(189 100% 50%)">pump head</text>
        <text x="34" y="32" fontSize="10" fill="hsl(265 85% 68%)">system head</text>
        <text x="60" y="258" fontSize="10" fill="hsl(var(--muted-foreground))">flow (L/s)</text>
        <text x="2" y="30" fontSize="10" fill="hsl(var(--muted-foreground))">m</text>
      </svg>
    </div>
  );
}