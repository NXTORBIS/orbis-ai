/** Ladder diagram, with live power flow along each rung. */
export default function LadderView({ program, state }) {
  const rowHeight = 30;
  const rungGap = 18;
  let y = 30;
  const rows = program.rungs.map((rung, index) => {
    const top = y;
    const height = Math.max(1, rung.branches.length) * rowHeight;
    y += height + rungGap;
    return { rung, index, top, height };
  });
  const total = y + 20;
  const railLeft = 26, railRight = 560, coilX = 470;
  const powered = (index) => !!state.powers?.[index];

  return (
    <div className="max-h-[34rem] overflow-auto rounded-xl border border-border bg-background/50">
      <svg viewBox={`0 0 600 ${total}`} className="min-w-[560px] w-full" role="img" aria-label="Ladder logic diagram with live power flow">
        <line x1={railLeft} y1="12" x2={railLeft} y2={total - 12} stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
        <line x1={railRight} y1="12" x2={railRight} y2={total - 12} stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
        <text x={railLeft - 18} y="20" fontSize="10" fill="hsl(var(--muted-foreground))">L1</text>
        <text x={railRight + 6} y="20" fontSize="10" fill="hsl(var(--muted-foreground))">N</text>

        {rows.map(({ rung, index, top, height }) => {
          const live = powered(index);
          const branchY = (branch) => top + rowHeight / 2 + branch * rowHeight;
          return (
            <g key={rung.id || index}>
              <text x={railLeft} y={top - 4} fontSize="10" fill="hsl(var(--muted-foreground))">{index + 1}. {rung.label}</text>
              <line x1={railLeft} y1={branchY(0)} x2={railLeft} y2={branchY(rung.branches.length - 1)} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" />
              {rung.branches.map((branch, b) => (
                <g key={b}>
                  <line x1={railLeft} y1={branchY(b)} x2={railRight} y2={branchY(b)} stroke={live ? 'hsl(189 100% 50% / 0.85)' : 'hsl(var(--border))'} strokeWidth={live ? 2.5 : 1.4} />
                  {branch.map((contact, c) => {
                    const x = 70 + c * 62;
                    const holds = contact.type === 'NC' ? !readBit(state, contact.addr) : readBit(state, contact.addr);
                    return (
                      <g key={c}>
                        <line x1={x - 9} y1={branchY(b) - 9} x2={x - 9} y2={branchY(b) + 9} stroke={holds && live ? 'hsl(189 100% 50%)' : 'hsl(var(--foreground) / 0.7)'} strokeWidth="2" />
                        <line x1={x + 9} y1={branchY(b) - 9} x2={x + 9} y2={branchY(b) + 9} stroke="hsl(var(--foreground) / 0.7)" strokeWidth="2" />
                        {contact.type === 'NC' && <line x1={x - 12} y1={branchY(b) + 10} x2={x + 12} y2={branchY(b) - 10} stroke="hsl(350 89% 60%)" strokeWidth="2" />}
                        <text x={x} y={branchY(b) - 14} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">{contact.addr}</text>
                      </g>
                    );
                  })}
                  {branch.length === 0 && <text x={railLeft + 40} y={branchY(b) + 4} fontSize="10" fill="hsl(var(--muted-foreground))">empty branch</text>}
                </g>
              ))}
              {rung.coils.map((coil, c) => {
                const detail = coil.type === 'TON' ? `${state.timers?.[coil.addr]?.acc?.toFixed(1) ?? '0.0'}/${coil.preset}s`
                  : coil.type === 'CTU' ? `${state.counters?.[coil.addr]?.acc ?? 0}/${coil.preset}`
                    : coil.type === 'set' ? 'S' : coil.type === 'reset' ? 'R' : '';
                return (
                  <g key={c}>
                    <path d={`M ${coilX} ${branchY(c) - 11} Q ${coilX + 13} ${branchY(c)} ${coilX} ${branchY(c) + 11}`} fill="none" stroke={live ? 'hsl(189 100% 50%)' : 'hsl(var(--foreground) / 0.7)'} strokeWidth="2" />
                    <path d={`M ${coilX + 26} ${branchY(c) - 11} Q ${coilX + 13} ${branchY(c)} ${coilX + 26} ${branchY(c) + 11}`} fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="2" />
                    <text x={coilX + 52} y={branchY(c) - 2} fontSize="11" fill="hsl(var(--foreground))">{coil.addr}</text>
                    <text x={coilX + 52} y={branchY(c) + 12} fontSize="10" fill="hsl(var(--muted-foreground))">{coil.type}{detail ? ` · ${detail}` : ''}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function readBit(state, addr) {
  if (!addr) return false;
  switch (addr[0]) {
    case 'X': return !!state.inputs?.[addr];
    case 'Y': return !!state.outputs?.[addr];
    case 'M': return !!state.memory?.[addr];
    case 'T': return !!state.timers?.[addr]?.done;
    case 'C': return !!state.counters?.[addr]?.done;
    default: return false;
  }
}