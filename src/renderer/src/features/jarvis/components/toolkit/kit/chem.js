export const ATOMS = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996,
  Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
  As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6,
  I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pt: 195.08, Au: 196.97,
  Hg: 200.59, Pb: 207.2, Bi: 208.98, U: 238.03,
};

const merge = (target, source, multiplier) => {
  Object.entries(source).forEach(([symbol, count]) => {
    target[symbol] = (target[symbol] || 0) + count * multiplier;
  });
};

const parseBody = (body, unknown) => {
  const root = {};
  const stack = [root];
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === '(' || char === '[' || char === '{') {
      stack.push({});
      index += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (stack.length < 2) return { error: 'Unbalanced brackets in "' + body + '".' };
      const inner = stack.pop();
      index += 1;
      let digits = '';
      while (index < body.length && /\d/.test(body[index])) {
        digits += body[index];
        index += 1;
      }
      merge(stack[stack.length - 1], inner, digits ? Number(digits) : 1);
      continue;
    }
    const symbol = body.slice(index).match(/^[A-Z][a-z]*/);
    if (!symbol) return { error: 'Could not read "' + char + '" in "' + body + '".' };
    index += symbol[0].length;
    let digits = '';
    while (index < body.length && /\d/.test(body[index])) {
      digits += body[index];
      index += 1;
    }
    if (!ATOMS[symbol[0]]) unknown.add(symbol[0]);
    merge(stack[stack.length - 1], { [symbol[0]]: digits ? Number(digits) : 1 }, 1);
  }
  if (stack.length !== 1) return { error: 'Unbalanced brackets in "' + body + '".' };
  return { counts: root };
};

export const parseFormula = (formula) => {
  const text = String(formula).replace(/\s+/g, '').replace(/[·.*+]/g, '·');
  if (!text) return { error: 'Enter a formula.' };
  const unknown = new Set();
  const total = {};
  const parts = text.split('·').filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lead = part.match(/^(\d+(?:\.\d+)?)(.*)$/);
    const multiplier = lead ? Number(lead[1]) : 1;
    const body = lead ? lead[2] : part;
    const parsed = parseBody(body, unknown);
    if (parsed.error) return { error: parsed.error };
    merge(total, parsed.counts, multiplier);
  }
  return { counts: total, unknown: [...unknown] };
};

export const molarMass = (formula) => {
  const parsed = parseFormula(formula);
  if (parsed.error) return { error: parsed.error };
  const entries = Object.entries(parsed.counts).map(([symbol, count]) => ({
    symbol,
    count,
    weight: ATOMS[symbol] || 0,
  }));
  const total = entries.reduce((sum, entry) => sum + entry.weight * entry.count, 0);
  if (!total) return { error: 'No recognised elements in "' + formula + '".' };
  return { mass: total, entries, unknown: parsed.unknown };
};

export const splitEquation = (equation) => {
  const sides = String(equation).split(/->|=>|=|→/).map((side) => side.trim());
  if (sides.length !== 2) return { error: 'Write the equation with -> between the reactants and the products.' };
  const term = (raw) => {
    const text = raw.trim();
    if (!text) return null;
    const match = text.match(/^(\d+(?:\.\d+)?)?\s*(.+)$/);
    const coefficient = match[1] ? Number(match[1]) : 1;
    const formula = match[2].trim();
    const mass = molarMass(formula);
    if (mass.error) return { error: mass.error };
    return { coefficient, formula, mass: mass.mass };
  };
  const parse = (side) => side.split('+').map(term).filter(Boolean);
  const reactants = parse(sides[0]);
  const products = parse(sides[1]);
  const failure = [...reactants, ...products].find((entry) => entry.error);
  if (failure) return { error: failure.error };
  if (!reactants.length || !products.length) return { error: 'Both sides of the equation need at least one species.' };
  return { reactants, products };
};