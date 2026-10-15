const WIDTH = 760;
const LANE = 74;
const LEFT = 96;

/** Space–time diagram: only the causal partial order is drawn, never an implied global clock. */
export default function CausalityView({ procs = [], events = [], closure = [], selectedIndex, onSelect }) {
  if (!events.length) return null;
  const maxSlot = Math.max(...events.map((event) => event.slot), 1);
  const step = (WIDTH - LEFT - 60) / Math.max(maxSlot, 1);
  const height = 40 + procs.length * LANE;
  const x = (slot) => LEFT + slot * step;
  const y = (p) => 28 + p * LANE;

  const past = selectedIndex != null ? new Set(closure[selectedIndex] ?? []) : new Set();
  const future = selectedIndex != null ? new Set(events.filter((event) => (closure[event.index] ?? []).includes(selectedIndex)).map((event) => event.index)) : new Set();
  const concurrent = selectedIndex != null ? new Set(events.filter((event) => event.index !== selectedIndex && !past.has(event.index) && !future.has(event.index)).map((event) => event.index)) : new Set();

  const tone = (index) => {
    if (index == null) return 'hsl(var(--cyan))';
    if (index === selectedIndex) return 'hsl(var(--foreground))';
    if (past.has(index)) return 'hsl(var(--cyan))';
    if (future.has(index)) return 'hsl(160 84% 52%)';
    if (concurrent.has(index)) return 'hsl(38 92% 55%)';
    return 'hsl(var(--muted-foreground))';
  };

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full min-w-[40rem] rounded-xl bg-background/50" role="img" aria-label="Distributed events in space and time, with only their causal order drawn">
      {procs.map((name, index) => (
        <g key={name}>
          <line x1={LEFT} y1={y(index)} x2={WIDTH - 40} y2={y(index)} stroke="hsl(var(--border))" strokeDasharray="3 5" />
          <text x="8" y={y(index) + 4} fontSize="11" fill="hsl(var(--muted-foreground))">{name}</text>
        </g>
      ))}
      {events.map((event) => (event.partner != null && event.kind === 'send' ? (
        <path
          key={`msg-${event.index}`}
          d={`M ${x(event.slot)} ${y(event.p)} C ${x(event.slot) + 40} ${y(event.p)}, ${x(events[event.partner].slot) - 40} ${y(events[event.partner].p)}, ${x(events[event.partner].slot)} ${y(events[event.partner].p)}`}
          fill="none"
          stroke="hsl(265 85% 68%)"
          strokeWidth="1.3"
          strokeDasharray="4 3"
          opacity="0.8"
        />
      ) : null))}
      {events.map((event) => (event.previous != null ? (
        <line key={`order-${event.index}`} x1={x(events[event.previous].slot)} y1={y(event.p)} x2={x(event.slot)} y2={y(event.p)} stroke="hsl(var(--border))" strokeWidth="1.4" />
      ) : null))}
      {events.map((event) => (
        <g key={`event-${event.index}`} role="button" tabIndex={0} onClick={() => onSelect?.(event.index)} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); onSelect?.(event.index); } }}>
          <circle cx={x(event.slot)} cy={y(event.p)} r="8" fill={tone(event.index)} opacity={selectedIndex === event.index || past.has(event.index) || future.has(event.index) ? 0.95 : 0.55} />
          <circle cx={x(event.slot)} cy={y(event.p)} r="8" fill="none" stroke="hsl(var(--background))" strokeWidth="1.5" />
          <text x={x(event.slot) + 12} y={y(event.p) - 10} fontSize="9" fill="hsl(var(--foreground))">{event.name}</text>
          <title>{`${procs[event.p]} · ${event.name} · clocks [${event.vc.join(', ')}] · layer ${event.index}`}</title>
        </g>
      ))}
    </svg>
  );
}