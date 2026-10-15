const TAU = Math.PI * 2;

/** Draw a rotating group of teeth on a pitch circle. `inward` flips them for an internal gear. */
function Teeth({ radius, count, angle, height, inward = false, className = 'fill-cyan-j/25 stroke-cyan-j/50' }) {
  const teeth = [];
  for (let i = 0; i < count; i += 1) {
    const a = angle + (i / count) * TAU;
    const inner = inward ? radius - height : radius;
    const outer = inward ? radius : radius + height;
    const w = ((TAU * radius) / count) * 0.34;
    teeth.push(
      <polygon
        key={i}
        points={[[inner, -w / 2], [outer, -w / 2], [outer, w / 2], [inner, w / 2]]
          .map(([r, o]) => `${(r * Math.cos(a) - o * Math.sin(a)).toFixed(2)},${(r * Math.sin(a) + o * Math.cos(a)).toFixed(2)}`)
          .join(' ')}
        className={className}
        strokeWidth="1"
      />,
    );
  }
  return <g>{teeth}</g>;
}

/** Front view of a planetary set: sun, planets and ring rotating at their true relative rates. */
export default function PlanetaryView({ solution, geometry }) {
  const { sun, planet, ring } = geometry;
  const scale = 150 / ring;
  const px = (value) => value * scale;
  const planets = solution.planets || [];

  return (
    <svg viewBox="-190 -150 380 300" className="w-full rounded-xl bg-background/50" role="img" aria-label="Planetary gear set rotating at its solved speeds">
      <g transform="translate(0,0)">
        <circle r={px(ring)} fill="hsl(var(--card) / 0.4)" stroke="hsl(var(--border))" strokeWidth="1.5" />
        <g transform={`rotate(${(solution.ringAngle * 180) / Math.PI})`}>
          <Teeth radius={px(ring)} count={solution.teeth.ring} angle={Math.PI / solution.teeth.ring} height={-px(3)} inward />
        </g>
        <circle r={px(ring)} fill="none" stroke="hsl(var(--cyan) / 0.35)" strokeWidth="1" strokeDasharray="4 4" />

        {planets.map((p, index) => (
          <g key={index} transform={`rotate(${(p.position * 180) / Math.PI}) translate(${px(sun + planet)},0)`}>
            <circle r={px(planet)} fill="hsl(var(--card))" stroke="hsl(var(--cyan) / 0.6)" strokeWidth="1.2" />
            <g transform={`rotate(${(p.spin * 180) / Math.PI})`}>
              <Teeth radius={px(planet)} count={solution.teeth.planet} angle={0} height={px(3)} />
            </g>
            <circle r={px(2)} className="fill-cyan-j" />
            <title>Planet {index + 1}: {p.rpm.toFixed(1)} rpm about its own axis</title>
          </g>
        ))}

        <g transform={`rotate(${(solution.sunAngle * 180) / Math.PI})`}>
          <circle r={px(sun)} fill="hsl(var(--card))" stroke="hsl(var(--cyan))" strokeWidth="1.5" />
          <Teeth radius={px(sun)} count={solution.teeth.sun} angle={0} height={px(3)} />
          <line x1={-px(sun)} x2={px(sun)} stroke="hsl(var(--foreground) / 0.5)" strokeWidth="1" />
        </g>

        {(solution.arrows || []).map((arrow, index) => (
          <g key={index}>
            <path
              d={`M ${-arrow.radius * scale} 0 A ${arrow.radius * scale} ${arrow.radius * scale} 0 0 ${arrow.speed >= 0 ? 1 : 0} ${arrow.radius * scale * Math.cos(arrow.sweep)} ${arrow.radius * scale * Math.sin(arrow.sweep)}`}
              fill="none"
              stroke={arrow.color}
              strokeWidth="2.5"
              markerEnd="url(#eng-arrow)"
            />
            <text x={px(arrow.radius) * 0.72} y={-6} fontSize="10" fill={arrow.color}>{arrow.label}</text>
          </g>
        ))}
      </g>
      <defs>
        <marker id="eng-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--cyan))" />
        </marker>
      </defs>
    </svg>
  );
}