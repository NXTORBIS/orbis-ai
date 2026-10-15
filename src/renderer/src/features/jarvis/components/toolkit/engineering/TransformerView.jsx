/** Transformer core and windings, with the flux circulating and the currents shown. */
export default function TransformerView({ readings: r, params }) {
  const coreDepth = 30;
  const ratio = params.n1 / params.n2;
  const fluxScale = Math.max(-1, Math.min(1, r.fluxDensityNow / Math.max(0.2, r.fluxDensity))) * 18;
  const turnTicks = (count, x, height) => Array.from({ length: Math.min(14, Math.max(4, Math.round(count / (params.n1 / 14)))) }, (_, i) => (
    <line key={i} x1={x} y1={40 + (i / 14) * height} x2={x + 44} y2={40 + (i / 14) * height} stroke="hsl(var(--foreground) / 0.35)" strokeWidth="1" />
  ));
  const saturated = r.saturated;

  return (
    <svg viewBox="0 0 460 320" className="w-full rounded-xl bg-background/50" role="img" aria-label="Transformer core with windings, flux and load current">
      <rect x="112" y="20" width="52" height="266" fill={saturated ? 'hsl(350 89% 60% / 0.22)' : 'hsl(var(--muted))'} stroke="hsl(var(--border))" strokeWidth="2" />
      <rect x="188" y="20" width="52" height="266" fill={saturated ? 'hsl(350 89% 60% / 0.22)' : 'hsl(var(--muted))'} stroke="hsl(var(--border))" strokeWidth="2" />
      <rect x="112" y="20" width="128" height={coreDepth} fill={saturated ? 'hsl(350 89% 60% / 0.22)' : 'hsl(var(--muted))'} stroke="hsl(var(--border))" strokeWidth="2" />
      <rect x="112" y={286 - coreDepth + 1} width="128" height={coreDepth} fill={saturated ? 'hsl(350 89% 60% / 0.22)' : 'hsl(var(--muted))'} stroke="hsl(var(--border))" strokeWidth="2" />

      <g>
        <rect x="48" y="60" width="64" height="186" rx="6" fill="hsl(189 100% 50% / 0.12)" stroke="hsl(189 100% 50% / 0.6)" />
        <text x="46" y="54" fontSize="11" fill="hsl(189 100% 50%)">primary · {params.n1} turns</text>
        {turnTicks(params.n1, 40, 180)}
        <text x="16" y="300" fontSize="11" fill="hsl(var(--foreground))">{r.measured.i1.toFixed(2)} A · {params.voltage} V</text>
      </g>
      <g>
        <rect x="240" y="60" width="64" height="186" rx="6" fill="hsl(38 92% 55% / 0.12)" stroke="hsl(38 92% 55% / 0.6)" />
        <text x="238" y="54" fontSize="11" fill="hsl(38 92% 55%)">secondary · {params.n2} turns</text>
        {turnTicks(params.n2, 264, 180)}
        <text x="240" y="300" fontSize="11" fill="hsl(var(--foreground))">{r.current2.toFixed(1)} A · {r.voltage2.toFixed(1)} V</text>
      </g>

      <g stroke="hsl(var(--cyan))" strokeWidth="2.5" fill="none" opacity="0.9">
        <path d={`M 112 ${50 + fluxScale} L 240 ${50 + fluxScale}`} markerEnd="url(#tr-arrow)" />
        <path d={`M 240 ${256 - fluxScale} L 112 ${256 - fluxScale}`} markerEnd="url(#tr-arrow)" />
        <line x1="112" y1="50" x2="112" y2="50" />
      </g>
      <text x="150" y="290" fontSize="10" fill="hsl(var(--muted-foreground))">flux {r.fluxDensityNow.toFixed(3)} T · {r.fluxDensity.toFixed(3)} T peak · {(r.saturation).toFixed(0)}% of the 1.6 T knee</text>

      <g>
        <path d="M 336 96 L 400 96 L 400 220 L 336 220" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        <rect x="396" y="120" width="26" height="76" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
        <text x="330" y="86" fontSize="10" fill="hsl(var(--muted-foreground))">load {(r.output / 1000).toFixed(2)} kW at pf {params.powerFactor}</text>
        <line x1="284" y1="96" x2="336" y2="96" stroke="hsl(38 92% 55%)" strokeWidth="3" markerEnd="url(#tr-load)" />
        <line x1="336" y1="220" x2="284" y2="220" stroke="hsl(38 92% 55%)" strokeWidth="3" markerEnd="url(#tr-load)" />
      </g>

      <text x="8" y="16" fontSize="11" fill={saturated ? 'hsl(350 89% 60%)' : 'hsl(var(--muted-foreground))'}>
        {saturated ? 'Core is saturating — flux density above 1.6 T' : 'Core operating below saturation'}
      </text>
      <text x="8" y="30" fontSize="10" fill="hsl(var(--muted-foreground))">turns ratio {ratio.toFixed(3)} : 1 · efficiency {(r.efficiency * 100).toFixed(2)}% · regulation {(r.regulation * 100).toFixed(2)}%</text>
      <defs>
        <marker id="tr-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(189 100% 50%)" /></marker>
        <marker id="tr-load" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(38 92% 55%)" /></marker>
      </defs>
    </svg>
  );
}