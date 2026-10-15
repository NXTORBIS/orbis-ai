const SIZE = 320;

/** The z-plane: located branch points, the monodromy loop around each one, and a control loop. */
export default function RiemannPlane({ branchPoints = [], control, monodromy = [], ext = 1.8, controlSheet = 0 }) {
  const px = (x) => SIZE / 2 + (x / ext) * (SIZE / 2 - 24);
  const py = (y) => SIZE / 2 - (y / ext) * (SIZE / 2 - 24);
  const radius = (0.32 / ext) * (SIZE / 2 - 24);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-sm rounded-xl bg-background/50" role="img" aria-label="Branch points and monodromy loops in the complex plane">
      <line x1="8" y1={SIZE / 2} x2={SIZE - 8} y2={SIZE / 2} stroke="hsl(var(--border))" strokeWidth="1" />
      <line x1={SIZE / 2} y1="8" x2={SIZE / 2} y2={SIZE - 8} stroke="hsl(var(--border))" strokeWidth="1" />
      <text x={SIZE - 22} y={SIZE / 2 - 6} fontSize="10" fill="hsl(var(--muted-foreground))">Re z</text>
      <text x={SIZE / 2 + 6} y="18" fontSize="10" fill="hsl(var(--muted-foreground))">Im z</text>
      {control && (
        <g>
          <circle cx={px(control[0])} cy={py(control[1])} r={radius * 0.94} fill="none" stroke="hsl(var(--foreground))" strokeDasharray="2 3" opacity="0.5" />
          <circle cx={px(control[0])} cy={py(control[1])} r="3" fill="hsl(var(--foreground))" />
          <text x={px(control[0]) + 6} y={py(control[1]) + 12} fontSize="9" fill="hsl(var(--muted-foreground))">control loop → sheet {controlSheet}</text>
        </g>
      )}
      {monodromy.map((entry, index) => (
        <g key={`${entry.point[0]}-${entry.point[1]}-${index}`}>
          <circle cx={px(entry.point[0])} cy={py(entry.point[1])} r={radius} fill="none" stroke="hsl(var(--cyan))" strokeDasharray="3 3" opacity="0.7" />
          <circle cx={px(entry.point[0])} cy={py(entry.point[1])} r="4" fill="hsl(var(--cyan))" />
          <text x={px(entry.point[0]) + 7} y={py(entry.point[1]) - 6} fontSize="9" fill="hsl(var(--cyan))">→ sheet {entry.sheet}</text>
        </g>
      ))}
      <text x="12" y={SIZE - 12} fontSize="9" fill="hsl(var(--muted-foreground))">filled dot = branch point · dashed circle = loop the continuation was taken around</text>
    </svg>
  );
}