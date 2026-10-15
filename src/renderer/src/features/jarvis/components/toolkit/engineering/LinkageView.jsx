/** Planar view of a four-bar linkage with its coupler curve, speed vectors and transmission angle. */
export default function LinkageView({ readings: r }) {
  if (!r.ok) return <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-500">{r.reason}</p>;
  const g = r.ground;
  const view = 150;
  const scale = view / 6;
  const ox = 190, oy = 130;
  const px = (p) => [ox + p.x * scale, oy - p.y * scale];
  const [o2x, o2y] = px({ x: 0, y: 0 });
  const [o4x, o4y] = px({ x: g.d, y: 0 });
  const [ax, ay] = px(r.jointA);
  const [bx, by] = px(r.jointB);
  const [cpx, cpy] = px(r.point);
  const arc = r.trace.map((p) => px(p).join(',')).join(' ');
  const vectorLength = (value) => Math.min(70, Math.abs(value) * 22);
  const speed = r.pointSpeed;

  return (
    <svg viewBox="0 0 400 300" className="w-full rounded-xl bg-background/50" role="img" aria-label="Four-bar linkage with its coupler curve">
      {arc.length > 0 && <polyline points={arc} fill="none" stroke="hsl(var(--cyan) / 0.35)" strokeWidth="1.2" />}
      <line x1={o2x - 26} y1={o2y + 18} x2={o4x + 26} y2={o4y + 18} stroke="hsl(var(--muted-foreground) / 0.6)" strokeWidth="2" strokeDasharray="6 4" />

      {r.singular && <text x="10" y="20" fontSize="11" fill="hsl(38 92% 55%)">Near a dead point — the output link cannot drive the input from here.</text>}

      <line x1={o2x} y1={o2y} x2={ax} y2={ay} stroke="hsl(38 92% 55%)" strokeWidth="5" strokeLinecap="round" />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="hsl(189 100% 50%)" strokeWidth="5" strokeLinecap="round" />
      <line x1={o4x} y1={o4y} x2={bx} y2={by} stroke="hsl(265 85% 68%)" strokeWidth="5" strokeLinecap="round" />

      {[[ax, ay, 'A'], [bx, by, 'B']].map(([x, y, label]) => (
        <g key={label}><circle cx={x} cy={y} r="5" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.5" /><text x={x + 8} y={y - 6} fontSize="10" fill="hsl(var(--foreground))">{label}</text></g>
      ))}
      <circle cx={o2x} cy={o2y} r="6" fill="hsl(var(--card))" stroke="hsl(38 92% 55%)" strokeWidth="2" />
      <circle cx={o4x} cy={o4y} r="6" fill="hsl(var(--card))" stroke="hsl(265 85% 68%)" strokeWidth="2" />
      <circle cx={cpx} cy={cpy} r="4" fill="hsl(var(--cyan))" />
      <title>Coupler point: {speed.toFixed(3)} m/s, {(r.point.x).toFixed(3)} / {(r.point.y).toFixed(3)} m</title>

      <line x1={bx} y1={by} x2={bx + vectorLength(r.omega4) * Math.cos(r.theta4 + Math.PI / 2)} y2={by - vectorLength(r.omega4) * Math.sin(r.theta4 + Math.PI / 2)} stroke="hsl(265 85% 68%)" strokeWidth="2" markerEnd="url(#link-arrow)" />
      <path d={`M ${bx} ${by} a 26 26 0 0 1 ${26 * Math.cos(r.theta4)} ${-26 * Math.sin(r.theta4)}`} fill="none" stroke="hsl(var(--muted-foreground) / 0.7)" strokeWidth="1" strokeDasharray="3 3" />
      <text x="8" y="288" fontSize="10" fill="hsl(var(--muted-foreground))">
        transmission angle {(r.transmission * 180 / Math.PI).toFixed(1)}° · ω4 {r.omega4.toFixed(3)} rad/s · mechanical advantage {Number.isFinite(r.mechanicalAdvantage) ? r.mechanicalAdvantage.toFixed(2) : '∞'}
      </text>
      <defs>
        <marker id="link-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="hsl(265 85% 68%)" />
        </marker>
      </defs>
    </svg>
  );
}