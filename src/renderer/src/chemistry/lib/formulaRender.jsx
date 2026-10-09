import { tokenizeFormula } from './chemistry.js';

// Renders a chemical formula with proper subscript <sub> elements.
export function renderFormula(formula) {
  return tokenizeFormula(formula).map((t, i) => {
    if (t.type === 'element') return <span key={i}>{t.value}</span>;
    if (t.type === 'sub') return <sub key={i}>{t.value}</sub>;
    if (t.type === 'open') return <span key={i}>(</span>;
    if (t.type === 'close') return <span key={i}>)</span>;
    return null;
  });
}

// Renders a full reaction equation: "2 H2 + O2 -> 2 H2O"
export function renderEquation(eq) {
  if (!eq || !eq.includes('->')) return <span>{eq}</span>;
  const [left, right] = eq.split('->');
  const renderSide = (side) => {
    const terms = side.split('+').map((t) => t.trim());
    return terms.map((term, idx) => {
      const m = term.match(/^(\d*\s*)(.*)$/);
      const coeff = m[1].trim();
      const formula = m[2].trim();
      return (
        <span key={idx}>
          {idx > 0 && <span className="mx-2 text-muted-foreground">+</span>}
          {coeff && <span className="text-foreground/70">{coeff} </span>}
          {renderFormula(formula)}
        </span>
      );
    });
  };
  return (
    <span className="font-mono-j text-lg">
      {renderSide(left)}
      <span className="mx-3 text-cyan-j">→</span>
      {renderSide(right)}
    </span>
  );
}