/** Schematic of the circuit with live pressures, flow arrows and the moving piston. */
export default function HydraulicView({ readings: r, params, onSelect, selected }) {
  const circuit = params.circuit;
  const active = circuit.components.filter((c) => c.enabled !== false);
  const pressureColour = (bar) => (bar > 80 ? 'hsl(350 89% 60%)' : bar > 30 ? 'hsl(38 92% 55%)' : 'hsl(189 100% 50%)');
  const arrowScale = (litres) => Math.min(26, Math.abs(litres) * 4);
  const nodeBox = (x, y, id) => (
    <g key={id}>
      <rect x={x} y={y} width="62" height="34" rx="7" fill="hsl(var(--card))" stroke={pressureColour(r.pressure[id] || 0)} strokeWidth="2" />
      <text x={x + 31} y={y + 16} fontSize="11" textAnchor="middle" fill="hsl(var(--foreground))">{id}</text>
      <text x={x + 31} y={y + 29} fontSize="10" textAnchor="middle" fill={pressureColour(r.pressure[id] || 0)}>{(r.pressure[id] || 0).toFixed(1)} bar</text>
    </g>
  );
  const pistonX = 250 + (r.position / r.stroke) * 120;

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 620 300" className="w-full rounded-xl bg-background/50" role="img" aria-label="Hydraulic circuit schematic with live pressures and flow">
        {nodeBox(24, 24, 'T')}
        {nodeBox(24, 150, 'P')}
        {nodeBox(430, 60, 'A')}
        {nodeBox(430, 190, 'B')}

        <path d="M 86 41 C 140 41 170 167 24 167 L 86 167" fill="none" stroke="hsl(var(--border))" strokeWidth="0" />
        <line x1="86" y1="41" x2="200" y2="41" stroke="hsl(var(--border))" strokeWidth="3" />
        <line x1="86" y1="167" x2="200" y2="167" stroke="hsl(var(--cyan) / 0.7)" strokeWidth="3" />

        {active.filter((c) => c.type === 'pump').map((c) => (
          <g key={c.id} role="button" tabIndex="0" onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <circle cx="200" cy="167" r="18" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(var(--cyan))'} strokeWidth="2" />
            <polygon points="200,155 212,167 200,179" fill="hsl(var(--cyan))" />
            <title>{`${c.id}: ${(r.pumpFlow).toFixed(2)} L/min, ${r.pumpPower.toFixed(3)} kW absorbed`}</title>
          </g>
        ))}
        {active.filter((c) => c.type === 'relief').map((c) => (
          <g key={c.id} role="button" tabIndex="0" onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <rect x="236" y="24" width="26" height="34" rx="4" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(var(--border))'} strokeWidth="2" />
            <line x1="236" y1="167" x2="236" y2="41" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="249" y1="41" x2="249" y2="24" stroke="hsl(var(--border))" strokeWidth="2" />
            <text x="284" y="30" fontSize="10" fill="hsl(var(--muted-foreground))">relief {r.reliefSetting} bar</text>
            <text x="284" y="44" fontSize="10" fill="hsl(var(--muted-foreground))">passing {r.reliefFlow.toFixed(2)} L/min</text>
            <title>{`Relief: set to ${r.reliefSetting} bar, currently passing ${r.reliefFlow.toFixed(3)} L/min`}</title>
          </g>
        ))}

        {active.filter((c) => c.type === 'dcv').map((c) => (
          <g key={c.id} role="button" tabIndex="0" onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <rect x="300" y="110" width="76" height="94" rx="8" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(var(--cyan) / 0.7)'} strokeWidth="2" />
            <line x1="300" y1="157" x2="236" y2="157" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="300" y1="167" x2="200" y2="167" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="338" y1="110" x2="338" y2="60" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="338" y1="204" x2="338" y2="207" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="376" y1="120" x2="430" y2="77" stroke="hsl(var(--border))" strokeWidth="3" />
            <line x1="376" y1="190" x2="430" y2="207" stroke="hsl(var(--border))" strokeWidth="3" />
            <text x="316" y="132" fontSize="10" fill="hsl(var(--foreground))">{params.dcvPosition}</text>
            <text x="316" y="150" fontSize="9" fill="hsl(var(--muted-foreground))">{(params.circuit.components.find((c) => c.type === 'dcv').params.area * 1e6).toFixed(1)} mm² port</text>
            <title>{`Directional valve in ${params.dcvPosition}`}</title>
          </g>
        ))}

        {active.filter((c) => c.type === 'restrictor').map((c) => (
          <g key={c.id} onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <rect x="392" y="238" width="30" height="24" rx="4" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(var(--border))'} strokeWidth="2" />
            <text x="430" y="254" fontSize="10" fill="hsl(var(--muted-foreground))">meter-out {(c.params.area * 1e6).toFixed(0)} mm²</text>
            <title>{`Meter-out restrictor, ${(c.params.area * 1e6).toFixed(1)} mm²`}</title>
          </g>
        ))}
        {active.filter((c) => c.type === 'accumulator').map((c) => (
          <g key={c.id} onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <rect x="60" y="200" width="34" height="58" rx="12" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(265 85% 68%)'} strokeWidth="2" />
            <text x="100" y="222" fontSize="10" fill="hsl(var(--muted-foreground))">accumulator {c.params.volume} L</text>
            <text x="100" y="236" fontSize="10" fill="hsl(var(--muted-foreground))">precharge {c.params.precharge} bar</text>
            <title>{`Gas accumulator, ${c.params.volume} L at ${c.params.precharge} bar precharge`}</title>
          </g>
        ))}
        {active.filter((c) => c.type === 'check').map((c) => (
          <g key={c.id} onClick={() => onSelect?.(c.id)} style={{ cursor: 'pointer' }}>
            <polygon points="404,20 428,34 404,48" fill="hsl(var(--card))" stroke={selected === c.id ? 'hsl(var(--foreground))' : 'hsl(var(--border))'} strokeWidth="2" />
            <text x="436" y="34" fontSize="10" fill="hsl(var(--muted-foreground))">check {c.params.crackBar} bar</text>
            <title>{`Check valve cracking at ${c.params.crackBar} bar`}</title>
          </g>
        ))}

        <g>
          <rect x="240" y="64" width="180" height="34" rx="6" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
          <rect x={pistonX} y="64" width="12" height="34" fill="hsl(var(--cyan))" />
          <line x1={pistonX + 12} y1="81" x2={470} y2="81" stroke="hsl(var(--cyan) / 0.8)" strokeWidth="7" />
          <rect x="240" y="188" width="180" height="34" rx="6" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
          <rect x={pistonX} y="188" width="12" height="34" fill="hsl(var(--cyan))" />
          <line x1={pistonX + 12} y1="205" x2="470" y2="205" stroke="hsl(var(--cyan) / 0.8)" strokeWidth="7" />
          <text x="250" y="118" fontSize="10" fill="hsl(var(--muted-foreground))">cap {((pistonX - 250) / 120 * r.stroke).toFixed(0)} mm</text>
          <text x="250" y="176" fontSize="10" fill="hsl(var(--muted-foreground))">rod side {((1 - (pistonX - 250) / 120) * r.stroke).toFixed(0)} mm</text>
          <line x1={pistonX} y1="150" x2={pistonX + Math.min(30, Math.abs(r.force) / 1200)} y2="150" stroke="hsl(38 92% 55%)" strokeWidth="3" markerEnd="url(#hyd-arrow)" />
          <text x={pistonX + 6} y="146" fontSize="10" fill="hsl(38 92% 55%)">{(r.force / 1000).toFixed(1)} kN</text>
        </g>

        <line x1="200" y1="167" x2="200" y2="41" stroke="hsl(var(--cyan) / 0.4)" strokeWidth={2 + arrowScale(r.pumpFlow)} markerEnd="url(#hyd-arrow)" />
        <text x="120" y="284" fontSize="10" fill="hsl(var(--muted-foreground))">
          piston {r.position.toFixed(1)} mm ({r.positionPercent.toFixed(0)}%) · {r.velocityMm.toFixed(1)} mm/s · cap flow {r.capFlow.toFixed(2)} L/min · hydraulic power {r.hydraulicPower.toFixed(3)} kW
        </text>
        <defs>
          <marker id="hyd-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="hsl(38 92% 55%)" /></marker>
        </defs>
      </svg>
      <p className="text-[11px] text-muted-foreground">Click a component to inspect it. Grey lines are the pressure and return paths; the arrow size follows the actual flow.</p>
    </div>
  );
}