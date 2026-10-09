import { ALL_ELEMENTS, ELEMENT_MAP, getElementBySymbol } from './elementsData.js';

// ---------- Formula parsing ----------
// Parses a chemical formula like "H2SO4", "Ca(OH)2", "Fe2(SO4)3" into a map { symbol: count }
export function parseFormula(formula) {
  if (!formula) return {};
  const clean = formula.replace(/\s+/g, '');
  const stack = [{}];
  let i = 0;
  const reElement = /^([A-Z][a-z]?)/;
  const reNumber = /^(\d+)/;
  while (i < clean.length) {
    const rest = clean.slice(i);
    if (rest[0] === '(') { stack.push({}); i += 1; continue; }
    if (rest[0] === ')') {
      const group = stack.pop();
      i += 1;
      const num = (rest.slice(1).match(reNumber) || [])[1];
      const mult = num ? parseInt(num, 10) : 1;
      const top = stack[stack.length - 1];
      for (const k in group) top[k] = (top[k] || 0) + group[k] * mult;
      if (num) i += num.length;
      continue;
    }
    const m = rest.match(reElement);
    if (!m) return {};
    const sym = m[1];
    i += sym.length;
    const num = (clean.slice(i).match(reNumber) || [])[1];
    const mult = num ? parseInt(num, 10) : 1;
    const top = stack[stack.length - 1];
    top[sym] = (top[sym] || 0) + mult;
    if (num) i += num.length;
  }
  return stack[0] || {};
}

// Parse formula into a structural token list preserving grouping (for rendering subscripts)
export function tokenizeFormula(formula) {
  if (!formula) return [];
  const tokens = [];
  let i = 0;
  const clean = formula.replace(/\s+/g, '');
  const reElement = /^([A-Z][a-z]?)/;
  const reNumber = /^(\d+)/;
  while (i < clean.length) {
    const rest = clean.slice(i);
    if (rest[0] === '(') { tokens.push({ type: 'open' }); i += 1; continue; }
    if (rest[0] === ')') { tokens.push({ type: 'close' }); i += 1; const n = (clean.slice(i).match(reNumber) || [])[1]; if (n) { tokens.push({ type: 'sub', value: n }); i += n.length; } continue; }
    const m = rest.match(reElement);
    if (!m) break;
    tokens.push({ type: 'element', value: m[1] });
    i += m[1].length;
    const n = (clean.slice(i).match(reNumber) || [])[1];
    if (n) { tokens.push({ type: 'sub', value: n }); i += n.length; }
  }
  return tokens;
}

// renderFormula (JSX) lives in ./formulaRender.jsx because .js files cannot contain JSX.

// ---------- Molar mass ----------
export function molarMass(formula) {
  const counts = parseFormula(formula);
  let mass = 0;
  const breakdown = [];
  for (const sym in counts) {
    const el = getElementBySymbol(sym);
    if (!el) return { mass: 0, breakdown: [] };
    const contribution = el.atomic_mass * counts[sym];
    mass += contribution;
    breakdown.push({ symbol: sym, name: el.name, count: counts[sym], atomicMass: el.atomic_mass, contribution });
  }
  return { mass: mass, breakdown };
}

// Count total atoms in a formula
export function atomCount(formula) {
  const counts = parseFormula(formula);
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

// Mass percent composition
export function massPercent(formula) {
  const { mass, breakdown } = molarMass(formula);
  if (!mass) return [];
  return breakdown.map((b) => ({ ...b, percent: (b.contribution / mass) * 100 }));
}

// ---------- Valency & compound prediction ----------
// Common valencies (charge magnitudes) used for simple binary ionic prediction.
const VALENCY = {
  H: [1], Li: [1], Na: [1], K: [1], Rb: [1], Cs: [1], Fr: [1],
  Be: [2], Mg: [2], Ca: [2], Sr: [2], Ba: [2], Ra: [2],
  B: [3], Al: [3], Ga: [3], In: [3], Tl: [1, 3],
  C: [4], Si: [4], Ge: [4], Sn: [2, 4], Pb: [2, 4], N: [3], P: [3, 5], As: [3, 5], Sb: [3, 5], Bi: [3, 5],
  O: [2], S: [2], Se: [2], Te: [2], Po: [2],
  F: [1], Cl: [1], Br: [1], I: [1], At: [1],
  Cu: [1, 2], Ag: [1], Au: [1, 3], Zn: [2], Cd: [2], Hg: [1, 2],
  Fe: [2, 3], Co: [2, 3], Ni: [2], Cr: [3], Mn: [2], V: [3, 5], Ti: [4], Pt: [2, 4], Pd: [2],
  La: [3], Ce: [3, 4], Nd: [3], Eu: [3], Gd: [3], Th: [4], U: [4, 6], Np: [4, 5], Pu: [4],
};

export function valencies(sym) {
  return VALENCY[sym] || [];
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

// Predict simple binary ionic/covalent compounds from two element symbols
// Returns array of { formula, name, type, note }
export function predictBinary(sym1, sym2) {
  const e1 = getElementBySymbol(sym1);
  const e2 = getElementBySymbol(sym2);
  if (!e1 || !e2) return [];
  const v1 = valencies(sym1);
  const v2 = valencies(sym2);
  if (!v1.length || !v2.length) return [];

  // Determine metal/nonmetal
  const metalCats = ['alkali-metal', 'alkaline-earth-metal', 'transition-metal', 'post-transition-metal', 'lanthanide', 'actinide'];
  const isMetal = (e) => metalCats.includes(e.category);
  const m1 = isMetal(e1), m2 = isMetal(e2);
  const results = [];
  const seen = new Set();

  // Handle special well-known pairs first (override generic logic for accuracy)
  const specials = knownCompounds([sym1, sym2]);
  if (specials.length) return specials;

  // Nonmetal + nonmetal molecular compounds (covalent) - vary by common ratios
  const bothNonmetal = !m1 && !m2;
  const oxoPair = (sym1 === 'O' || sym2 === 'O');

  const add = (formula, type, note) => {
    if (seen.has(formula)) return;
    seen.add(formula);
    results.push({ formula, name: nameForFormula(formula), type, note });
  };

  if (bothNonmetal) {
    // Covalent: use prefixes for several common ratios
    if (oxoPair) {
      const other = sym1 === 'O' ? sym2 : sym1;
      const oxoForms = {
        H: [['H2O', 'Water'], ['H2O2', 'Hydrogen peroxide']],
        C: [['CO', 'Carbon monoxide'], ['CO2', 'Carbon dioxide']],
        N: [['N2O', 'Nitrous oxide'], ['NO', 'Nitric oxide'], ['NO2', 'Nitrogen dioxide'], ['N2O5', 'Dinitrogen pentoxide']],
        S: [['SO2', 'Sulfur dioxide'], ['SO3', 'Sulfur trioxide']],
        P: [['P4O6', 'Phosphorus trioxide'], ['P4O10', 'Phosphorus pentoxide']],
        Cl: [['Cl2O', 'Dichlorine monoxide'], ['Cl2O7', 'Dichlorine heptoxide']],
      };
      if (oxoForms[other]) {
        oxoForms[other].forEach(([f, n]) => add(f, 'covalent oxide', n));
        if (results.length) return results;
      }
    }
    // Generic covalent ratios
    add(`${sym1}${sym2}`, 'covalent', '1:1 ratio');
    add(`${sym1}2${sym2}`, 'covalent', '2:1 ratio');
    add(`${sym1}${sym2}2`, 'covalent', '1:2 ratio');
    add(`${sym1}2${sym2}3`, 'covalent', '2:3 ratio');
    add(`${sym1}3${sym2}2`, 'covalent', '3:2 ratio');
    return results;
  }

  // Metal + nonmetal: ionic. Cross-multiply valencies.
  const metal = m1 ? e1 : e2;
  const nonmetal = m1 ? e2 : e1;
  const metalSym = metal.symbol;
  const nmSym = nonmetal.symbol;
  const mv = m1 ? v1 : v2;
  const nv = m1 ? v2 : v1;

  for (const a of mv) {
    for (const b of nv) {
      const g = gcd(a, b);
      const mc = b / g;
      const nc = a / g;
      const metalPart = mc === 1 ? metalSym : `${metalSym}${mc}`;
      const nmPart = nc === 1 ? nmSym : `${nmSym}${nc}`;
      add(`${metalPart}${nmPart}`, 'ionic', `Metal valency ${a}, nonmetal valency ${b}`);
    }
  }
  return results;
}

// Named/known compounds for specific element pairs (verified)
function knownCompounds(syms) {
  const set = new Set(syms);
  const match = (a, b) => (set.has(a) && set.has(b));
  const out = [];
  const push = (formula, name, type, note = '') => out.push({ formula, name, type, note });
  if (match('Na', 'Cl')) push('NaCl', 'Sodium chloride', 'ionic', 'Common table salt');
  if (match('Mg', 'Cl')) push('MgCl2', 'Magnesium chloride', 'ionic');
  if (match('Ca', 'Cl')) push('CaCl2', 'Calcium chloride', 'ionic');
  if (match('K', 'Cl')) push('KCl', 'Potassium chloride', 'ionic');
  if (match('Ca', 'C')) push('CaC2', 'Calcium carbide', 'ionic');
  if (match('Ca', 'O')) { push('CaO', 'Calcium oxide', 'ionic', 'Quicklime'); push('CaO2', 'Calcium peroxide', 'ionic'); }
  if (match('Fe', 'O')) { push('FeO', 'Iron(II) oxide', 'ionic'); push('Fe2O3', 'Iron(III) oxide', 'ionic', 'Rust'); push('Fe3O4', 'Iron(II,III) oxide', 'ionic', 'Magnetite'); }
  if (match('Cu', 'O')) { push('Cu2O', 'Copper(I) oxide', 'ionic'); push('CuO', 'Copper(II) oxide', 'ionic'); }
  if (match('Al', 'O')) push('Al2O3', 'Aluminium oxide', 'ionic', 'Corundum');
  if (match('Na', 'O')) { push('Na2O', 'Sodium oxide', 'ionic'); push('Na2O2', 'Sodium peroxide', 'ionic'); }
  if (match('K', 'O')) { push('K2O', 'Potassium oxide', 'ionic'); push('K2O2', 'Potassium peroxide', 'ionic'); }
  if (match('H', 'O')) { push('H2O', 'Water', 'covalent'); push('H2O2', 'Hydrogen peroxide', 'covalent'); }
  if (match('C', 'O')) { push('CO', 'Carbon monoxide', 'covalent'); push('CO2', 'Carbon dioxide', 'covalent'); }
  if (match('N', 'O')) { push('N2O', 'Dinitrogen monoxide', 'covalent'); push('NO', 'Nitrogen monoxide', 'covalent'); push('NO2', 'Nitrogen dioxide', 'covalent'); push('N2O5', 'Dinitrogen pentoxide', 'covalent'); }
  if (match('S', 'O')) { push('SO2', 'Sulfur dioxide', 'covalent'); push('SO3', 'Sulfur trioxide', 'covalent'); }
  if (match('N', 'H')) { push('NH3', 'Ammonia', 'covalent'); push('N2H4', 'Hydrazine', 'covalent'); }
  if (match('P', 'H')) push('PH3', 'Phosphine', 'covalent');
  if (match('H', 'Cl')) push('HCl', 'Hydrogen chloride', 'covalent acid');
  if (match('H', 'S')) { push('H2S', 'Hydrogen sulfide', 'covalent'); }
  if (match('H', 'F')) push('HF', 'Hydrogen fluoride', 'covalent acid');
  if (match('H', 'Br')) push('HBr', 'Hydrogen bromide', 'covalent acid');
  if (match('H', 'I')) push('HI', 'Hydrogen iodide', 'covalent acid');
  if (match('Cl', 'O')) { push('Cl2O', 'Dichlorine monoxide', 'covalent'); push('Cl2O7', 'Dichlorine heptoxide', 'covalent'); }
  if (match('P', 'O')) { push('P4O6', 'Phosphorus trioxide', 'covalent'); push('P4O10', 'Phosphorus pentoxide', 'covalent'); }
  if (match('Si', 'O')) push('SiO2', 'Silicon dioxide', 'covalent', 'Quartz / silica');
  if (match('Zn', 'O')) push('ZnO', 'Zinc oxide', 'ionic');
  if (match('Ag', 'O')) { push('Ag2O', 'Silver(I) oxide', 'ionic'); }
  if (match('Mg', 'O')) push('MgO', 'Magnesium oxide', 'ionic');
  if (match('Li', 'O')) { push('Li2O', 'Lithium oxide', 'ionic'); }
  return out;
}

// Generic compound name from formula (best-effort Stock + prefix system)
export function nameForFormula(formula) {
  const counts = parseFormula(formula);
  const syms = Object.keys(counts);
  if (syms.length === 0) return 'Unknown';
  const elOf = (s) => getElementBySymbol(s);
  const metalCats = ['alkali-metal', 'alkaline-earth-metal', 'transition-metal', 'post-transition-metal', 'lanthanide', 'actinide'];
  const isMetal = (s) => { const e = elOf(s); return e && metalCats.includes(e.category); };

  // Binary ionic
  if (syms.length === 2) {
    const metals = syms.filter(isMetal);
    const nonmetals = syms.filter((s) => !isMetal(s));
    if (metals.length === 1 && nonmetals.length === 1) {
      const m = metals[0], nm = nonmetals[0];
      const metalEl = elOf(m);
      const nmEl = elOf(nm);
      // anion root
      const anionRoot = { O: 'oxide', S: 'sulfide', F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide', N: 'nitride', P: 'phosphide', C: 'carbide', H: 'hydride' }[nm] || (nmEl ? nmEl.name.toLowerCase() + 'ide' : nm.toLowerCase() + 'ide');
      // roman numeral for variable valency metals
      const variable = ['Fe', 'Cu', 'Sn', 'Pb', 'Hg', 'Au', 'Co', 'Cr', 'Mn', 'Ti', 'V', 'Pt', 'Pd', 'Ce', 'Tl', 'Eu', 'U'];
      let metalName = metalEl ? metalEl.name : m;
      let suffix = '';
      if (variable.includes(m)) {
        const charge = counts[nm] * (nm === 'O' ? 2 : 2) / counts[m]; // approximate
        const roman = { 1: '(I)', 2: '(II)', 3: '(III)', 4: '(IV)', 5: '(V)', 6: '(VI)', 7: '(VII)' }[Math.round(charge)] || '';
        suffix = roman;
      }
      return `${metalName}${suffix} ${anionRoot}`;
    }
    // binary covalent
    if (metals.length === 0) {
      const prefix = (n) => ({ 1: 'mono', 2: 'di', 3: 'tri', 4: 'tetra', 5: 'penta', 6: 'hexa', 7: 'hepta' }[n] || '');
      const a = syms[0], b = syms[1];
      const aEl = elOf(a), bEl = elOf(b);
      // second element gets -ide suffix and prefix; first element gets prefix only if count > 1
      const secondRoot = (bEl ? bEl.name.toLowerCase() : b.toLowerCase()).replace(/um$/, '') + 'ide';
      const aname = aEl ? aEl.name.toLowerCase() : a.toLowerCase();
      const p1 = counts[a] > 1 ? prefix(counts[a]) : '';
      const p2 = prefix(counts[b]);
      return `${p1 ? p1 + ' ' : ''}${aname} ${p2}${secondRoot}`.trim();
    }
  }
  // Fallback: list element names
  return syms.map((s) => elOf(s)?.name || s).join(' compound');
}

// ---------- Balancing (simple, two-reactant synthesis) ----------
// Given product formula and its constituent element symbols, build a balanced
// synthesis equation "a A + b B -> c Product" by atom conservation.
export function balanceSynthesis(sym1, sym2, formula) {
  const prodCounts = parseFormula(formula);
  // require exactly these two elements
  const keys = Object.keys(prodCounts);
  if (keys.length !== 2) return null;
  const c1 = prodCounts[sym1] || 0;
  const c2 = prodCounts[sym2] || 0;
  if (!c1 || !c2) return null;
  // a*sym1 + b*sym2 -> c*formula
  // a = c1*c, b = c2*c. choose c = 1 then reduce by gcd.
  let a = c1, b = c2, c = 1;
  const g = gcd(gcd(a, b), c);
  a /= g; b /= g; c /= g;
  const f = (n) => (n === 1 ? '' : n);
  const symForm = (s) => s;
  return {
    equation: `${f(a)}${symForm(sym1)} + ${f(b)}${symForm(sym2)} → ${f(c)}${formula}`,
    a, b, c,
  };
}

// ---------- Periodic trend helpers ----------
export function elementsInGroup(g) { return ALL_ELEMENTS.filter((e) => e.group === g && e.period < 8); }
export function elementsInPeriod(p) { return ALL_ELEMENTS.filter((e) => e.period === p); }

// Search across many fields
export function searchElements(query) {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_ELEMENTS;
  return ALL_ELEMENTS.filter((e) => {
    const numMatch = String(e.atomic_number) === q;
    const massStr = String(e.atomic_mass);
    return (
      e.name.toLowerCase().includes(q) ||
      e.symbol.toLowerCase() === q ||
      e.symbol.toLowerCase().startsWith(q) ||
      numMatch ||
      massStr.startsWith(q) ||
      e.category.includes(q) ||
      (e.discovered_by || '').toLowerCase().includes(q) ||
      (e.uses || '').toLowerCase().includes(q) ||
      (e.electron_configuration || '').toLowerCase().includes(q)
    );
  });
}

// ---------- Daily content (deterministic by date) ----------
const DAILY_FACTS = [
  "Water (H₂O) is one of the few substances that expands when it freezes — that's why ice floats.",
  "A single drop of water contains about 1.5 sextillion (1.5 × 10²¹) molecules.",
  "Gold is so unreactive that it can be found in nature in its pure metallic form.",
  "Carbon forms more known compounds than all other elements combined — over 10 million.",
  "Mercury is the only metal that is liquid at room temperature.",
  "Hydrogen makes up about 75% of all normal matter in the universe.",
  "The element with the highest melting point is carbon (sublimes near 3,642 °C).",
  "Technetium was the first element to be artificially produced, in 1937.",
  "Oxygen is the most abundant element in Earth's crust by mass (about 46%).",
  "Iodine sublimes directly from a solid to a beautiful violet vapor.",
  "Gallium melts in your hand — its melting point is just 29.76 °C.",
  "Iron is the most abundant element (by mass) in the whole Earth, making up its core.",
];

const DAILY_FORMULAS = [
  { name: 'Sulfuric Acid', formula: 'H2SO4', note: "King of Chemicals — most produced industrial chemical." },
  { name: 'Glucose', formula: 'C6H12O6', note: "Primary product of photosynthesis and body fuel." },
  { name: 'Ammonia', formula: 'NH3', note: "Made by Haber process; key fertilizer precursor." },
  { name: 'Sodium Chloride', formula: 'NaCl', note: "Common table salt; essential electrolyte." },
  { name: 'Calcium Carbonate', formula: 'CaCO3', note: "Limestone, marble, shells, and antacids." },
  { name: 'Carbon Dioxide', formula: 'CO2', note: "Greenhouse gas and product of respiration." },
  { name: 'Ethanol', formula: 'C2H5OH', note: "Alcohol in beverages and a biofuel." },
  { name: 'Hydrochloric Acid', formula: 'HCl', note: "Stomach acid and strong laboratory acid." },
];

const DAILY_REACTIONS = [
  { name: 'Haber Process', equation: 'N2 + 3H2 → 2NH3', note: 'Industrial ammonia synthesis; Fe catalyst, high pressure.' },
  { name: 'Combustion of Methane', equation: 'CH4 + 2O2 → CO2 + 2H2O', note: 'The reaction behind natural gas flames.' },
  { name: 'Rusting of Iron', equation: '4Fe + 3O2 → 2Fe2O3', note: 'Slow oxidation forming iron(III) oxide.' },
  { name: 'Neutralization', equation: 'HCl + NaOH → NaCl + H2O', note: 'Classic acid–base reaction giving salt + water.' },
  { name: 'Photosynthesis', equation: '6CO2 + 6H2O → C6H12O6 + 6O2', note: 'Plants convert sunlight into chemical energy.' },
  { name: 'Electrolysis of Water', equation: '2H2O → 2H2 + O2', note: 'Splitting water with electricity.' },
];

const DAILY_QUIZZES = [
  { q: 'Which element has the symbol "Fe"?', options: ['Fluorine', 'Iron', 'Francium', 'Fermium'], a: 1 },
  { q: 'What is the most electronegative element?', options: ['Oxygen', 'Chlorine', 'Fluorine', 'Nitrogen'], a: 2 },
  { q: 'Which gas makes up ~78% of Earth\'s atmosphere?', options: ['Oxygen', 'Carbon dioxide', 'Argon', 'Nitrogen'], a: 3 },
  { q: 'How many electrons can the first shell hold?', options: ['2', '8', '18', '32'], a: 0 },
  { q: 'Which is a noble gas?', options: ['Chlorine', 'Neon', 'Sodium', 'Iron'], a: 1 },
  { q: 'Atomic number of Carbon?', options: ['4', '6', '8', '12'], a: 1 },
  { q: 'Which element is liquid at room temperature (besides mercury)?', options: ['Bromine', 'Iodine', 'Gallium', 'Both A and C'], a: 3 },
  { q: 'What is the lightest element?', options: ['Helium', 'Hydrogen', 'Lithium', 'Carbon'], a: 1 },
];

function dayIndex() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

export function dailyFact() { return DAILY_FACTS[dayIndex() % DAILY_FACTS.length]; }
export function dailyFormula() { return DAILY_FORMULAS[dayIndex() % DAILY_FORMULAS.length]; }
export function dailyReaction() { return DAILY_REACTIONS[dayIndex() % DAILY_REACTIONS.length]; }
export function dailyQuiz() { return DAILY_QUIZZES[dayIndex() % DAILY_QUIZZES.length]; }
export function featuredElement() {
  return ALL_ELEMENTS[(dayIndex() % 118) + 1];
}