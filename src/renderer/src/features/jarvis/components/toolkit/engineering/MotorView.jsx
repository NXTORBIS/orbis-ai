const TAU = Math.PI * 2;

/** Cross-section of a DC machine: stator poles, armature loop, commutator and brushes. */
export default function MotorView({ readings: r, params }) {
  const angle = r.rotorAngle;
  const deg = (a) => (a * 180) / Math.PI;
  const rotorRadius = 74;
  const loopRadius = 52;

  // Which commutator segment is under the positive brush right now — this is the
  // commutation that keeps the torque one-signed as the rotor turns.
  const plusBrush = Math.PI / 2;
  const segmentAStart = angle;
  const offset = ((plusBrush - segmentAStart) % TAU + TAU) % TAU;
  const segmentAPositive = offset < Math.PI;
  const conductorSign = (bar) => (bar === 'A' ? (segmentAPositive ? 1 : -1) : segmentAPositive ? -1 : 1) * Math.sign(r.current || 1);
  const torqueScale = Math.min(70, Math.abs(r.torque) * 40);
  const torqueSign = Math.sign(r.torque || 0) || 1;

  return (
    <svg viewBox="-180 -145 360 290" className="w-full rounded-xl bg-background/50" role="img" aria-label="DC machine cross-section with rotating armature, commutator and brushes">
      <circle r="120" fill="hsl(var(--card) / 0.35)" stroke="hsl(var(--border))" strokeWidth="1.5" />
      <path d="M -104 -60 A 120 120 0 0 1 -104 60" fill="none" stroke="hsl(350 89% 60% / 0.75)" strokeWidth="16" strokeLinecap="round" />
      <path d="M 104 -60 A 120 120 0 0 0 104 60" fill="none" stroke="hsl(210 90% 60% / 0.75)" strokeWidth="16" strokeLinecap="round" />
      <text x="-118" y="4" fontSize="13" fill="hsl(350 89% 60%)">N</text>
      <text x="110" y="4" fontSize="13" fill="hsl(210 90% 60%)">S</text>

      {[-46, -23, 0, 23, 46].map((y) => (
        <g key={y}>
          <line x1="-86" y1={y} x2="76" y2={y} stroke="hsl(var(--cyan) / 0.4)" strokeWidth="1.2" strokeDasharray="5 4" />
          <polygon points={`76,${y} 66,${y - 4} 66,${y + 4}`} fill="hsl(var(--cyan) / 0.6)" />
        </g>
      ))}

      <circle r="62" fill="hsl(var(--card))" stroke="hsl(var(--cyan) / 0.55)" strokeWidth="1.5" />
      <g transform={`rotate(${deg(angle)})`}>
        <rect x={-6} y={-loopRadius - 10} width="12" height="20" rx="3" fill={conductorSign('A') > 0 ? 'hsl(350 89% 60% / 0.8)' : 'hsl(210 90% 60% / 0.8)'} stroke="hsl(var(--foreground) / 0.4)" />
        <rect x={-6} y={loopRadius - 10} width="12" height="20" rx="3" fill={conductorSign('B') > 0 ? 'hsl(350 89% 60% / 0.8)' : 'hsl(210 90% 60% / 0.8)'} stroke="hsl(var(--foreground) / 0.4)" />
        <line x1="0" y1={-loopRadius} x2="0" y2={loopRadius} stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
        <line x1={-26} y1={-loopRadius} x2="26" y2={-loopRadius} stroke="hsl(var(--foreground) / 0.35)" strokeWidth="1" />
        <line x1={-26} y1={loopRadius} x2="26" y2={loopRadius} stroke="hsl(var(--foreground) / 0.35)" strokeWidth="1" />
        <text x="9" y={-loopRadius + 4} fontSize="9" fill="hsl(var(--muted-foreground))">{conductorSign('A') > 0 ? '⊙' : '⊗'}</text>
        <text x="9" y={loopRadius + 4} fontSize="9" fill="hsl(var(--muted-foreground))">{conductorSign('B') > 0 ? '⊙' : '⊗'}</text>
      </g>

      <g>
        <circle r="20" fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth="1.2" />
        <path d={`M ${20 * Math.cos(angle)} ${20 * Math.sin(angle)} A 20 20 0 0 1 ${20 * Math.cos(angle + Math.PI)} ${20 * Math.sin(angle + Math.PI)}`} fill="none" stroke={segmentAPositive ? 'hsl(350 89% 60%)' : 'hsl(210 90% 60%)'} strokeWidth="5" />
        <path d={`M ${20 * Math.cos(angle + Math.PI)} ${20 * Math.sin(angle + Math.PI)} A 20 20 0 0 1 ${20 * Math.cos(angle + TAU)} ${20 * Math.sin(angle + TAU)}`} fill="none" stroke={segmentAPositive ? 'hsl(210 90% 60%)' : 'hsl(350 89% 60%)'} strokeWidth="5" />
        <rect x="-4" y="-32" width="8" height="12" rx="2" fill="hsl(var(--foreground))" />
        <rect x="-4" y="20" width="8" height="12" rx="2" fill="hsl(var(--foreground))" />
        <text x="6" y="-26" fontSize="9" fill="hsl(350 89% 60%)">+</text>
        <text x="6" y="30" fontSize="9" fill="hsl(210 90% 60%)">−</text>
      </g>

      <g>
        <path d={`M 0 ${-torqueScale} l ${torqueSign * 14} ${torqueSign * -0} l 0 0`} stroke="hsl(38 92% 55%)" strokeWidth="0" />
        <line x1={torqueSign * 62} y1="-104" x2={torqueSign * (62 + torqueScale)} y2="-104" stroke="hsl(38 92% 55%)" strokeWidth="3" markerEnd="url(#motor-arrow)" />
        <text x={torqueSign * 66} y="-110" fontSize="10" fill="hsl(38 92% 55%)">torque {r.torque.toFixed(3)} N·m</text>
        <line x1={torqueSign * 62} y1="112" x2={torqueSign * (62 - Math.min(70, Math.abs(r.backEmf) * 2))} y2="112" stroke="hsl(189 100% 50%)" strokeWidth="3" markerEnd="url(#motor-arrow)" />
        <text x={torqueSign * 58} y="126" fontSize="10" fill="hsl(189 100% 50%)">back-EMF {r.backEmf.toFixed(2)} V</text>
      </g>

      <text x="-170" y="132" fontSize="10" fill="hsl(var(--muted-foreground))">
        {r.current.toFixed(3)} A · {r.speedRpm.toFixed(0)} rpm · winding {r.temperature.toFixed(1)} °C
      </text>
      <text x="-170" y="146" fontSize="10" fill="hsl(var(--muted-foreground))">
        K {params.k} V·s/rad · field fixed by the stator, armature current reversed by the commutator
      </text>
      <defs>
        <marker id="motor-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
        </marker>
      </defs>
    </svg>
  );
}