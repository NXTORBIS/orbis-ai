import { hoistForce } from '@jarvis/components/toolkit/engineering/sluiceCore';

/** Elevation of the gate, the pools either side, the jet and the pressure on each face. */
export default function SluiceView({ readings: r, params }) {
  const scale = 46;                 // px per metre
  const sill = 250;
  const gateX = 260;
  const y = (metres) => sill - metres * scale;
  const channelLeft = 30;
  const channelRight = 470;
  const pressureWidth = 62;
  const maxDepth = Math.max(1, r.h1);
  const triangles = (depth, face) => {
    if (depth <= 0.02) return null;
    const x0 = face === 'up' ? gateX - 6 : gateX + 6;
    const dir = face === 'up' ? -1 : 1;
    return <polygon points={`${x0},${sill} ${x0 + dir * pressureWidth * (depth / maxDepth)},${sill} ${x0},${y(depth)}`} fill="hsl(189 100% 50% / 0.16)" stroke="hsl(189 100% 50% / 0.5)" strokeWidth="1" />;
  };
  const gatePath = params.gateType === 'radial'
    ? (() => {
      const cx = gateX, cy = sill - (params.trunnionHeight * scale);
      const radius = params.radius * scale;
      const angle = Math.acos(Math.min(1, (params.trunnionHeight / params.radius)));
      return `M ${cx + radius * Math.sin(angle)} ${sill} A ${radius} ${radius} 0 0 0 ${cx + radius * Math.sin(angle + (r.gate / params.gateHeight) * 0.5)} ${cy + radius * Math.cos(angle + (r.gate / params.gateHeight) * 0.5)}`;
    })()
    : `M ${gateX - 9} ${sill} L ${gateX - 9} ${sill - r.gate * scale} L ${gateX + 9} ${sill - r.gate * scale} L ${gateX + 9} ${sill}`;

  return (
    <svg viewBox="0 0 500 300" className="w-full rounded-xl bg-background/50" role="img" aria-label="Sluice gate elevation with pool levels, jet and pressure distribution">
      <rect x={channelLeft} y={sill} width={channelRight - channelLeft} height="16" fill="hsl(var(--muted))" />
      <rect x={channelLeft} y={y(r.h2)} width={channelRight - channelLeft} height={sill - y(r.h2)} fill="hsl(210 90% 60% / 0.22)" />
      <rect x={channelLeft} y={y(r.h1)} width={gateX - channelLeft} height={sill - y(r.h1)} fill="hsl(210 90% 60% / 0.3)" />
      <line x1={channelLeft} y1={y(r.h1)} x2={gateX} y2={y(r.h1)} stroke="hsl(210 90% 65%)" strokeWidth="2" />
      <line x1={gateX} y1={y(r.h2)} x2={channelRight} y2={y(r.h2)} stroke="hsl(210 90% 65%)" strokeWidth="2" />

      {triangles(r.h1, 'up')}
      {triangles(r.h2, 'down')}

      <path d={gatePath} fill="none" stroke="hsl(var(--foreground))" strokeWidth="7" strokeLinecap="round" />
      {params.gateType === 'radial' && <circle cx={gateX} cy={sill - params.trunnionHeight * scale} r="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />}
      <line x1={gateX} y1={sill - r.gate * scale - (params.gateType === 'radial' ? 0 : 0)} x2={gateX} y2={sill - params.gateHeight * scale - 22} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={gateX + 14} y={sill - params.gateHeight * scale - 26} fontSize="10" fill="hsl(var(--muted-foreground))">hoist</text>

      {r.particles.map((particle, i) => {
        const x = channelLeft + (particle.x + 0.15) * (channelRight - channelLeft) * 0.8;
        const depth = particle.x < 0 ? r.h1 : r.h2;
        return <circle key={i} cx={x} cy={sill - 6 - particle.y * (depth * scale)} r="2.4" fill="hsl(210 90% 70%)" opacity="0.85" />;
      })}

      <line x1={gateX} y1={sill - r.gate * scale / 2} x2={gateX - 30 - Math.min(60, r.force / 9000)} y2={sill - r.gate * scale / 2} stroke="hsl(38 92% 55%)" strokeWidth="3" markerEnd="url(#sluice-arrow)" />
      <text x={12} y={sill + 34} fontSize="10" fill="hsl(38 92% 55%)">hydrostatic {r.force.toFixed(0)} N · centre of pressure at {r.centreOfPressure.toFixed(2)} m above the sill</text>
      <text x={12} y="22" fontSize="11" fill="hsl(var(--foreground))">{r.regime} · Q = {r.flow.toFixed(2)} m³/s</text>
      <text x={12} y="40" fontSize="10" fill="hsl(var(--muted-foreground))">upstream {r.h1.toFixed(2)} m · downstream {r.h2.toFixed(2)} m · gate {r.gate.toFixed(2)} m ({r.gatePercent.toFixed(0)}% open)</text>
      <text x={12} y="56" fontSize="10" fill="hsl(var(--muted-foreground))">gate velocity {r.gateVelocity.toFixed(2)} m/s · Froude {r.froude.toFixed(2)} · hoist load {(hoistForce(params, r.h1, r.h2, r.gate).total / 1000).toFixed(1)} kN</text>
      <defs>
        <marker id="sluice-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(38 92% 55%)" /></marker>
      </defs>
    </svg>
  );
}