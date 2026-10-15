const WIDTH = 900;

const COLOURS = {
  load: 'hsl(var(--cyan))',
  mul: 'hsl(265 85% 68%)',
  add: 'hsl(160 84% 52%)',
  sub: 'hsl(38 92% 55%)',
};

/** Cycle-by-cycle pipeline chart: issue, execution window and retirement for every instruction. */
export default function OooTimeline({ lifecycle = [], code = [], cycles = 1, frames = [] }) {
  if (!lifecycle.length) return null;
  const left = 54;
  const right = 12;
  const rowGap = 22;
  const top = 26;
  const plotWidth = WIDTH - left - right;
  const x = (cycle) => left + (cycle / Math.max(cycles, 1)) * plotWidth;
  const height = top + lifecycle.length * rowGap + 10;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full min-w-[42rem] rounded-xl bg-background/50" role="img" aria-label="Instruction lifecycle per cycle">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line x1={x(cycles * fraction)} y1={top - 6} x2={x(cycles * fraction)} y2={height - 8} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 4" />
            <text x={x(cycles * fraction)} y={top - 10} fontSize="9" textAnchor="middle" fill="hsl(var(--muted-foreground))">{Math.round(cycles * fraction)}</text>
          </g>
        ))}
        {lifecycle.map((entry, index) => {
          const y = top + index * rowGap;
          const colour = COLOURS[entry.op] || 'hsl(var(--cyan))';
          const instruction = code[entry.pc];
          const label = instruction.op === 'load' ? `${instruction.op} [${instruction.addr}] → ${instruction.dst}` : `${instruction.op} ${instruction.a}, ${instruction.b} → ${instruction.dst}`;
          return (
            <g key={entry.pc}>
              <text x="4" y={y + 4} fontSize="9" fill="hsl(var(--muted-foreground))">{entry.pc}</text>
              <text x="16" y={y + 4} fontSize="9" fill="hsl(var(--foreground))" opacity="0.75">{label}</text>
              <rect x={x(entry.issue)} y={y - 5} width={Math.max(1.5, x(entry.writeback) - x(entry.issue))} height="10" rx="2.5" fill={colour} opacity="0.28" />
              <circle cx={x(entry.issue)} cy={y} r="3" fill={colour} />
              <circle cx={x(entry.execute)} cy={y} r="2" fill="hsl(var(--foreground))" opacity="0.5" />
              <circle cx={x(entry.writeback)} cy={y} r="3" fill="hsl(var(--foreground))" />
              <rect x={x(entry.commit)} y={y - 6} width="2.5" height="12" fill="hsl(var(--cyan))" />
              <title>{label} · issue {entry.issue}, execute {entry.execute}, write back {entry.writeback}, retire {entry.commit}</title>
            </g>
          );
        })}
        {frames.length > 0 && (
          <g>
            {frames.map((frame) => {
              const y = height - 6 - 8;
              const scale = Math.max(...frames.map((item) => item.robDepth), 1);
              return <rect key={frame.cycle} x={x(frame.cycle - 1)} y={y - (frame.robDepth / scale) * 8} width={Math.max(1, plotWidth / frames.length - 0.4)} height={(frame.robDepth / scale) * 8 + 1} fill="hsl(var(--cyan))" opacity="0.35" />;
            })}
            <text x="4" y={height - 4} fontSize="8" fill="hsl(var(--muted-foreground))">ROB</text>
          </g>
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.load }} /> issue</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-foreground/50" /> execute start</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-foreground" /> write back</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-cyan-j" /> retire</span>
        <span>shaded band = reservation-station window · bars at the bottom = reorder-buffer occupancy</span>
      </div>
    </div>
  );
}