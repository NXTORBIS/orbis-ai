/** Plan view of a lock: two pools, the chamber, mitre gates and the vessel. */
export default function LockView({ readings: r, params }) {
  const groundTop = 210;
  const scale = Math.max(7, Math.min(20, 190 / Math.max(params.upstreamLevel, 4)));
  const water = (x, width, level) => ({ x, width, y: groundTop - level * scale, height: level * scale });
  const up = water(14, 96, params.upstreamLevel);
  const chamber = water(118, 186, r.level);
  const down = water(312, 96, params.downstreamLevel);
  const gateLeaf = (x, openness) => {
    const angle = 20 + openness * 70;
    return <g transform={`translate(${x} ${groundTop})`}>
      <line x1="0" y1="-8" x2={28 * Math.sin((angle * Math.PI) / 180)} y2={-8 - 28 * Math.cos((angle * Math.PI) / 180)} stroke="hsl(var(--foreground))" strokeWidth="6" strokeLinecap="round" />
      <line x1="0" y1="-8" x2={28 * Math.sin(((180 - angle) * Math.PI) / 180)} y2={-8 - 28 * Math.cos(((180 - angle) * Math.PI) / 180)} stroke="hsl(var(--foreground))" strokeWidth="6" strokeLinecap="round" />
      <circle cx="0" cy="-8" r="3.5" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" />
    </g>;
  };

  return (
    <svg viewBox="0 0 440 290" className="w-full rounded-xl bg-background/50" role="img" aria-label="Canal lock plan with pools, chamber, gates and vessel">
      <rect x="10" y={groundTop} width="420" height="10" fill="hsl(var(--muted))" />
      <rect {...up} fill="hsl(210 90% 60% / 0.28)" />
      <rect {...chamber} fill="hsl(210 90% 60% / 0.24)" />
      <rect {...down} fill="hsl(210 90% 60% / 0.28)" />
      <line x1="14" y1={up.y} x2="110" y2={up.y} stroke="hsl(210 90% 65%)" strokeWidth="2" />
      <line x1="118" y1={chamber.y} x2="304" y2={chamber.y} stroke="hsl(210 90% 65%)" strokeWidth="2" />
      <line x1="312" y1={down.y} x2="408" y2={down.y} stroke="hsl(210 90% 65%)" strokeWidth="2" />
      <line x1="114" y1="70" x2="114" y2={groundTop + 10} stroke="hsl(var(--muted-foreground))" strokeWidth="3" />
      <line x1="308" y1="70" x2="308" y2={groundTop + 10} stroke="hsl(var(--muted-foreground))" strokeWidth="3" />
      <line x1="10" y1={groundTop - 4} x2="430" y2={groundTop - 4} stroke="hsl(var(--border))" strokeWidth="1" />

      {gateLeaf(114, r.upGate)}
      {gateLeaf(308, r.downGate)}

      {r.upValve > 0.05 && <line x1="114" y1={groundTop - params.upstreamLevel * scale - 6} x2="114" y2={groundTop - r.level * scale - 6} stroke="hsl(189 100% 50%)" strokeWidth="3" markerEnd="url(#lock-arrow)" />}
      {r.downValve > 0.05 && <line x1="308" y1={groundTop - r.level * scale - 6} x2="308" y2={groundTop - params.downstreamLevel * scale - 6} stroke="hsl(189 100% 50%)" strokeWidth="3" markerEnd="url(#lock-arrow)" />}

      <g transform={`translate(${126 + r.vessel * 140} ${groundTop - 12})`}>
        <rect width="42" height="14" rx="5" fill="hsl(var(--card))" stroke="hsl(38 92% 55%)" strokeWidth="2" />
        <rect x="16" y="-7" width="10" height="8" rx="2" fill="hsl(38 92% 55% / 0.5)" />
        <title>Vessel at {(r.vessel * 100).toFixed(0)}% through the chamber</title>
      </g>

      <text x="14" y="24" fontSize="11" fill="hsl(var(--foreground))">{r.phase}</text>
      <text x="14" y="40" fontSize="10" fill="hsl(var(--muted-foreground))">chamber {r.level.toFixed(2)} m · upstream {params.upstreamLevel} m · downstream {params.downstreamLevel} m</text>
      <text x="14" y="56" fontSize="10" fill="hsl(var(--muted-foreground))">{r.gateState} · valve flow {(r.flowUp - r.flowDown).toFixed(3)} m³/s · head to upstream {r.headUpstream.toFixed(2)} m</text>
      <text x="14" y="262" fontSize="10" fill="hsl(var(--muted-foreground))">cycles completed {r.cycles} · phase time {r.phaseTime.toFixed(0)} s · predicted equalisation from here {r.predictedFill.toFixed(0)} s</text>
      <defs>
        <marker id="lock-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(189 100% 50%)" /></marker>
      </defs>
    </svg>
  );
}