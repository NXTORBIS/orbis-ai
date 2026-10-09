// Equation.jsx — lightweight, dependency-free equation renderer. Renders a Unicode/ASCII
// math expression in a styled block with an optional "where" caption.
// No KaTeX needed — keeps the bundle small and reliable.
export default function Equation({ children, where, label }) {
  return (
    <div className="my-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
      {label && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>}
      <div className="overflow-x-auto font-mono text-sm leading-relaxed text-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
        <span className="italic">{children}</span>
      </div>
      {where && <div className="mt-1 text-[11px] text-muted-foreground">{where}</div>}
    </div>
  );
}