const SIZE = 420;
const PAD = 24;

/** Reachable and avoidable sets drawn in the state plane, with the enumerated corner cloud. */
export default function ReachabilityView({ forward, backward, reference, system, forwardStep, backwardStep, showCloud = true }) {
  const all = [
    ...(forward?.history?.[forwardStep]?.vertices ?? []),
    ...(backward?.history?.[backwardStep]?.vertices ?? []),
    [-system.safe, -system.safe], [system.safe, system.safe],
    ...(showCloud ? reference.cloud : []),
  ];
  if (!all.length) return null;
  const bound = Math.max(
    system.safe,
    ...all.map((point) => Math.max(Math.abs(point[0]), Math.abs(point[1]))),
    0.1,
  ) * 1.08;
  const scale = (SIZE - PAD * 2) / (2 * bound);
  const px = (x) => SIZE / 2 + x * scale;
  const py = (y) => SIZE / 2 - y * scale;
  const path = (vertices) => vertices.map((point) => `${px(point[0])},${py(point[1])}`).join(' ');
  const forwardVertices = forward?.history?.[forwardStep]?.vertices ?? [];
  const backwardVertices = backward?.history?.[backwardStep]?.vertices ?? [];

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-xl rounded-xl bg-background/50" role="img" aria-label="Reachable and avoidable sets in the state plane">
        <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} fill="none" stroke="hsl(var(--border))" />
        <line x1={px(0)} y1={PAD} x2={px(0)} y2={SIZE - PAD} stroke="hsl(var(--border))" strokeDasharray="2 4" />
        <line x1={PAD} y1={py(0)} x2={SIZE - PAD} y2={py(0)} stroke="hsl(var(--border))" strokeDasharray="2 4" />
        <rect x={px(-system.safe)} y={py(system.safe)} width={system.safe * 2 * scale} height={system.safe * 2 * scale} fill="none" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
        {showCloud && reference.cloud.map((point, index) => <circle key={`cloud-${index}`} cx={px(point[0])} cy={py(point[1])} r="1.1" fill="hsl(var(--cyan))" opacity="0.35" />)}
        {backwardVertices.length > 2 && <polygon points={path(backwardVertices)} fill="hsl(265 85% 68% / 0.22)" stroke="hsl(265 85% 68%)" strokeWidth="1.6" />}
        {forwardVertices.length > 2 && <polygon points={path(forwardVertices)} fill="hsl(var(--cyan) / 0.14)" stroke="hsl(var(--cyan))" strokeWidth="1.8" />}
        {forwardVertices.map((point, index) => <circle key={`v-${index}`} cx={px(point[0])} cy={py(point[1])} r="2" fill="hsl(var(--cyan))" />)}
        <circle cx={px(0)} cy={py(0)} r="3" fill="hsl(var(--foreground))" />
        <text x={PAD + 4} y={SIZE - PAD - 6} fontSize="10" fill="hsl(var(--muted-foreground))">state 1</text>
        <text x={PAD - 14} y={PAD + 10} fontSize="10" fill="hsl(var(--muted-foreground))">state 2</text>
      </svg>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: 'hsl(var(--cyan) / 0.35)' }} /> reachable hull at step {forwardStep}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: 'hsl(265 85% 68% / 0.4)' }} /> avoidable region at step {backwardStep}</span>
        <span>dashed rectangle = safe set · dots = sampled admissible trajectories</span>
      </div>
    </div>
  );
}