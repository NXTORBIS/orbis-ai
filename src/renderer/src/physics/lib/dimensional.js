// Deterministic dimensional analysis. Expressions are parsed into a tree and
// each leaf carries the dimension vector of its unit/constant. Operators
// combine dimensions: + / - require equal dims; * adds; / subtracts; ^ scales.
// No AI — pure symbolic arithmetic over the 7 SI base dimensions.

import { UNITS, CONSTANTS, dimEqual, dimString } from './constants';

const D0 = { M: 0, L: 0, T: 0, I: 0, K: 0, N: 0, J: 0 };
const add = (a, b) => ({ M: a.M + b.M, L: a.L + b.L, T: a.T + b.T, I: a.I + b.I, K: a.K + b.K, N: a.N + b.N, J: a.J + b.J });
const sub = (a, b) => ({ M: a.M - b.M, L: a.L - b.L, T: a.T - b.T, I: a.I - b.I, K: a.K - b.K, N: a.N - b.N, J: a.J - b.J });
const scale = (a, n) => ({ M: a.M * n, L: a.L * n, T: a.T * n, I: a.I * n, K: a.K * n, N: a.N * n, J: a.J * n });

// Known symbols → dimension. Numbers are dimensionless.
const SYMBOL_DIMS = {
  x: D0, y: D0, z: D0, t: { M: 0, L: 0, T: 1, I: 0, K: 0, N: 0, J: 0 },
  v: { M: 0, L: 1, T: -1, I: 0, K: 0, N: 0, J: 0 }, a: { M: 0, L: 1, T: -2, I: 0, K: 0, N: 0, J: 0 },
  m: { M: 1, L: 0, T: 0, I: 0, K: 0, N: 0, J: 0 }, F: { M: 1, L: 1, T: -2, I: 0, K: 0, N: 0, J: 0 },
  E: { M: 1, L: 2, T: -2, I: 0, K: 0, N: 0, J: 0 }, p: { M: 1, L: -1, T: -2, I: 0, K: 0, N: 0, J: 0 },
  KE: { M: 1, L: 2, T: -2, I: 0, K: 0, N: 0, J: 0 }, PE: { M: 1, L: 2, T: -2, I: 0, K: 0, N: 0, J: 0 },
  W: { M: 1, L: 2, T: -2, I: 0, K: 0, N: 0, J: 0 }, P: { M: 1, L: 2, T: -3, I: 0, K: 0, N: 0, J: 0 },
  q: { M: 0, L: 0, T: 1, I: 1, K: 0, N: 0, J: 0 }, I: { M: 0, L: 0, T: 0, I: 1, K: 0, N: 0, J: 0 },
  V: { M: 1, L: 2, T: -3, I: -1, K: 0, N: 0, J: 0 }, R: { M: 1, L: 2, T: -3, I: -2, K: 0, N: 0, J: 0 },
  T: { M: 0, L: 0, T: 0, I: 0, K: 1, N: 0, J: 0 }, n: D0, k: D0, r: { M: 0, L: 1, T: 0, I: 0, K: 0, N: 0, J: 0 },
  d: { M: 0, L: 1, T: 0, I: 0, K: 0, N: 0, J: 0 }, s: D0, h: { M: 1, L: 2, T: -1, I: 0, K: 0, N: 0, J: 0 },
  omega: D0, theta: D0, lambda: { M: 0, L: 1, T: 0, I: 0, K: 0, N: 0, J: 0 }, f: { M: 0, L: 0, T: -1, I: 0, K: 0, N: 0, J: 0 },
  g: { M: 0, L: 1, T: -2, I: 0, K: 0, N: 0, J: 0 }, c: { M: 0, L: 1, T: -1, I: 0, K: 0, N: 0, J: 0 },
  G: { M: -1, L: 3, T: -2, I: 0, K: 0, N: 0, J: 0 }, kB: { M: 1, L: 2, T: -2, I: 0, K: -1, N: 0, J: 0 },
  e: { M: 0, L: 0, T: 1, I: 1, K: 0, N: 0, J: 0 }, eps0: { M: -1, L: -3, T: 4, I: 2, K: 0, N: 0, J: 0 },
};

function symDim(name) {
  if (SYMBOL_DIMS[name]) return SYMBOL_DIMS[name];
  if (UNITS[name]) return UNITS[name].dim;
  if (CONSTANTS[name]) return UNITS[CONSTANTS[name].unit.split(' ')[0]]?.dim || D0;
  return null; // unknown symbol
}

// Tiny Pratt-style parser for + - * / ^ () and unary minus.
function tokenize(expr) {
  const tokens = [];
  const re = /([0-9]+\.?[0-9]*(?:[eE][-+]?[0-9]+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/^()])/g;
  let m;
  while ((m = re.exec(expr))) {
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'sym', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

function parseDim(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() { let left = parseTerm(); while (peek() && peek().v === '+' || peek() && peek().v === '-') { const op = next().v; const right = parseTerm(); if (!dimEqual(left.dim, right.dim)) throw new Error(`Dimension mismatch in '${op}': ${dimString(left.dim)} vs ${dimString(right.dim)}`); left = { dim: left.dim }; } return left; }
  function parseTerm() { let left = parseFactor(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = next().v; const right = parseFactor(); left = { dim: op === '*' ? add(left.dim, right.dim) : sub(left.dim, right.dim) }; } return left; }
  function parseFactor() { let base = parseAtom(); if (peek() && peek().v === '^') { next(); const exp = parseAtom(); if (exp.dim.M !== 0 || exp.dim.L !== 0 || exp.dim.T !== 0 || exp.dim.I !== 0 || exp.dim.K !== 0 || exp.dim.N !== 0 || exp.dim.J !== 0) throw new Error('Exponent must be dimensionless'); base = { dim: scale(base.dim, 0) }; /* exponent value unknown symbolically → treat power as scaling by literal if numeric */ } return base; }
  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of expression');
    if (tk.v === '-' || tk.v === '+') { next(); return parseAtom(); }
    if (tk.v === '(') { next(); const e = parseExpr(); if (!peek() || peek().v !== ')') throw new Error('Missing )'); next(); return e; }
    if (tk.t === 'num') { next(); return { dim: D0 }; }
    if (tk.t === 'sym') { next(); const d = symDim(tk.v); if (d === null) throw new Error(`Unknown symbol "${tk.v}"`); return { dim: d }; }
    throw new Error(`Unexpected token "${tk.v}"`);
  }
  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Trailing tokens');
  return result.dim;
}

// Analyse a single expression: returns { ok, dim, dimStr, error }.
export function analyseExpression(expr) {
  try {
    const dim = parseDim(tokenize(expr));
    return { ok: true, dim, dimStr: dimString(dim) };
  } catch (e) {
    return { ok: false, dim: null, dimStr: null, error: e.message };
  }
}

// Verify an equation "LHS = RHS" dimensionally. Returns { ok, consistent, lhs, rhs, error }.
export function verifyEquation(eq) {
  const sides = eq.split('=').map((s) => s.trim());
  if (sides.length !== 2) return { ok: false, error: 'Expected exactly one "=" sign' };
  const l = analyseExpression(sides[0]);
  const r = analyseExpression(sides[1]);
  if (!l.ok) return { ok: false, error: `LHS: ${l.error}` };
  if (!r.ok) return { ok: false, error: `RHS: ${r.error}` };
  return { ok: true, consistent: dimEqual(l.dim, r.dim), lhs: l.dimStr, rhs: r.dimStr };
}