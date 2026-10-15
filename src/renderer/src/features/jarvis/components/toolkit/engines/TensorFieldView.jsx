const SIZE = 380;
const PAD = 22;

/** Eigenvector glyphs: a line along each eigenvector, its length the size of the eigenvalue. */
export default function TensorFieldView({ cells = [], n = 40, extent = 1, singularities = [], selected, onSelect }) {
  if (!cells.length) return null;
  const stride = Math.max(1, Math.round(n / 24));
  const scale = SIZE - PAD * 2;
  const px = (x) => PAD + ((x + extent) / (2 * extent)) * scale;
  const py = (y) => SIZE - PAD - ((y + extent) / (2 * extent)) * scale;
  const rows = [];
  for (let j = 0; j < n; j += stride) {
    for (let i = 0; i < n; i += stride) rows.push(cells[j * n + i]);
  }
  const largest = Math.max(...cells.map((cell) => Math.max(Math.abs(cell.l1), Math.abs(cell.l2))), 1e-9);

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-lg rounded-xl bg-background/50" role="img" aria-label="Eigenvector and eigenvalue glyphs of the tensor field">
        <rect x={PAD} y={PAD} width={scale} height={scale} fill="none" stroke="hsl(var(--border))" />
        <line x1={px(0)} y1={PAD} x2={px(0)} y2={SIZE - PAD} stroke="hsl(var(--border))" strokeDasharray="2 4" />
        <line x1={PAD} y1={py(0)} x2={SIZE - PAD} y2={py(0)} stroke="hsl(var(--border))" strokeDasharray="2 4" />
        {rows.map((cell, index) => {
          const cx = px(cell.x);
          const cy = py(cell.y);
          const half = (cell.l1 / largest) * (stride * (scale / n)) * 0.85;
          const minor = (cell.l2 / largest) * (stride * (scale / n)) * 0.85;
          const along = [Math.cos(cell.angle), -Math.sin(cell.angle)];
          const across = [-Math.sin(cell.angle), -Math.cos(cell.angle)];
          const colour = cell.l1 >= 0 ? 'hsl(var(--cyan))' : 'hsl(350 89% 60%)';
          return (
            <g key={`${cell.x}-${cell.y}-${index}`} opacity="0.9">
              <line x1={cx - along[0] * half} y1={cy - along[1] * half} x2={cx + along[0] * half} y2={cy + along[1] * half} stroke={colour} strokeWidth="1.1" />
              <line x1={cx - across[0] * minor} y1={cy - across[1] * minor} x2={cx + across[0] * minor} y2={cy + across[1] * minor} stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" opacity="0.7" />
            </g>
          );
        })}
        {singularities.map((point) => (
          <g key={`${point.x}-${point.y}`}>
            <circle cx={px(point.x)} cy={py(point.y)} r="6" fill="hsl(var(--foreground))" opacity="0.15" />
            <circle cx={px(point.x)} cy={py(point.y)} r="3.4" fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.4" />
            <text x={px(point.x) + 7} y={py(point.y) - 5} fontSize="9" fill="hsl(var(--foreground))">{point.index > 0 ? '+' : '−'}{Math.abs(point.index).toFixed(2)} {point.kind}</text>
          </g>
        ))}
        {selected && <circle cx={px(selected.x)} cy={py(selected.y)} r="9" fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" strokeDasharray="2 3" />}
      </svg>
      <p className="text-[10px] text-muted-foreground">Cyan lines are the major eigenvector where its eigenvalue is positive, red where it is negative; the faint grey line is the minor eigenvector. Glyphs are drawn every {stride} sample{stride > 1 ? 's' : ''} so the picture stays readable. Click a glyph to inspect the tensor there.</p>
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-10" onPointerLeave={() => undefined}>
        {rows.slice(0, 120).map((cell, index) => (
          <button
            key={`probe-${cell.x}-${cell.y}-${index}`}
            type="button"
            onClick={() => onSelect?.(cell)}
            className="h-5 rounded border border-border/60 text-[8px] text-muted-foreground transition hover:border-cyan-j/60 hover:text-foreground"
            title={`λ₁ ${cell.l1.toFixed(3)}, λ₂ ${cell.l2.toFixed(3)}`}
          >
            ·
          </button>
        ))}
      </div>
    </div>
  );
}