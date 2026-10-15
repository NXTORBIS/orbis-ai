/**
 * A small, safe arithmetic/logic expression language used by scenario models,
 * risk models and custom experiments. Expressions are parsed into an AST and
 * compiled into closures — JavaScript `eval`/`Function` are never used, so
 * user-provided text cannot execute code.
 *
 * Grammar (lowest to highest precedence):
 *   expr    := or
 *   or      := and (("||" | "or") and)*
 *   and     := not (("&&" | "and") not)*
 *   not     := ("!" | "not") not | cmp
 *   cmp     := add (("<" | "<=" | ">" | ">=" | "==" | "!=") add)?
 *   add     := mul (("+" | "-") mul)*
 *   mul     := unary (("*" | "/" | "%") unary)*
 *   unary   := "-" unary | "+" unary | pow
 *   pow     := primary ("^" unary)?            (right-associative)
 *   primary := number | identifier | call | "(" expr ")"
 *
 * Booleans are represented as 1 (true) and 0 (false). Any non-zero value is
 * truthy.
 */
import { EngineError } from '../core/result';

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'unary'; op: '-' | '!'; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] };

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'eof'; pos: number };

export const MAX_EXPRESSION_LENGTH = 2000;
const MAX_DEPTH = 64;

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number; doc: string }> = {
  abs: { arity: [1, 1], fn: Math.abs, doc: 'Absolute value' },
  sqrt: { arity: [1, 1], fn: Math.sqrt, doc: 'Square root' },
  exp: { arity: [1, 1], fn: Math.exp, doc: 'e raised to x' },
  ln: { arity: [1, 1], fn: Math.log, doc: 'Natural logarithm' },
  log: { arity: [1, 1], fn: Math.log, doc: 'Natural logarithm' },
  log10: { arity: [1, 1], fn: Math.log10, doc: 'Base-10 logarithm' },
  floor: { arity: [1, 1], fn: Math.floor, doc: 'Round down' },
  ceil: { arity: [1, 1], fn: Math.ceil, doc: 'Round up' },
  round: { arity: [1, 1], fn: Math.round, doc: 'Round to nearest integer' },
  sin: { arity: [1, 1], fn: Math.sin, doc: 'Sine (radians)' },
  cos: { arity: [1, 1], fn: Math.cos, doc: 'Cosine (radians)' },
  tan: { arity: [1, 1], fn: Math.tan, doc: 'Tangent (radians)' },
  pow: { arity: [2, 2], fn: Math.pow, doc: 'x raised to y' },
  min: { arity: [1, 32], fn: Math.min, doc: 'Smallest argument' },
  max: { arity: [1, 32], fn: Math.max, doc: 'Largest argument' },
  clamp: { arity: [3, 3], fn: (x, lo, hi) => Math.min(hi, Math.max(lo, x)), doc: 'Restrict x to [lo, hi]' },
  if: { arity: [3, 3], fn: (c, a, b) => (c !== 0 ? a : b), doc: 'if(condition, valueIfTrue, valueIfFalse)' },
  sign: { arity: [1, 1], fn: Math.sign, doc: 'Sign of x (−1, 0, 1)' },
};

export const EXPRESSION_FUNCTIONS = Object.entries(FUNCTIONS).map(([name, f]) => ({ name, doc: f.doc }));

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, true: 1, false: 0 };

const KEYWORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (numMatch) {
      tokens.push({ t: 'num', v: parseFloat(numMatch[0]), pos: i });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (idMatch) {
      const word = idMatch[0];
      const kw = KEYWORD_OPS[word.toLowerCase()];
      if (kw) tokens.push({ t: 'op', v: kw, pos: i });
      else tokens.push({ t: 'id', v: word, pos: i });
      i += word.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/%^()<>!,'.includes(ch)) {
      tokens.push({ t: 'op', v: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '=') throw syntax(`Use "==" to compare values (position ${i + 1}).`);
    throw syntax(`Unexpected character "${ch}" at position ${i + 1}.`);
  }
  tokens.push({ t: 'eof', pos: src.length });
  return tokens;
}

function syntax(message: string): EngineError {
  return new EngineError([{ code: 'syntax', message }]);
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private take(): Token {
    return this.tokens[this.i++];
  }
  private expectOp(v: string) {
    const t = this.take();
    if (t.t !== 'op' || t.v !== v) throw syntax(`Expected "${v}" at position ${t.pos + 1}.`);
  }
  private enter() {
    if (++this.depth > MAX_DEPTH) throw syntax('Expression is nested too deeply.');
  }
  private leave() {
    this.depth--;
  }

  parse(): Node {
    const n = this.or();
    const t = this.peek();
    if (t.t !== 'eof') throw syntax(`Unexpected "${'v' in t ? t.v : ''}" at position ${t.pos + 1}.`);
    return n;
  }

  private or(): Node {
    let left = this.and();
    while (this.isOp('||')) {
      this.take();
      left = { type: 'binary', op: '||', left, right: this.and() };
    }
    return left;
  }
  private and(): Node {
    let left = this.not();
    while (this.isOp('&&')) {
      this.take();
      left = { type: 'binary', op: '&&', left, right: this.not() };
    }
    return left;
  }
  private not(): Node {
    if (this.isOp('!')) {
      this.take();
      this.enter();
      const arg = this.not();
      this.leave();
      return { type: 'unary', op: '!', arg };
    }
    return this.cmp();
  }
  private cmp(): Node {
    const left = this.add();
    const t = this.peek();
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      this.take();
      const right = this.add();
      const n2 = this.peek();
      if (n2.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(n2.v)) {
        throw syntax('Chained comparisons are ambiguous; combine them with "and", e.g. a < x and x < b.');
      }
      return { type: 'binary', op: t.v, left, right };
    }
    return left;
  }
  private add(): Node {
    let left = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.take() as { v: string }).v;
      left = { type: 'binary', op, left, right: this.mul() };
    }
    return left;
  }
  private mul(): Node {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.take() as { v: string }).v;
      left = { type: 'binary', op, left, right: this.unary() };
    }
    return left;
  }
  private unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const op = (this.take() as { v: string }).v;
      this.enter();
      const arg = this.unary();
      this.leave();
      return op === '-' ? { type: 'unary', op: '-', arg } : arg;
    }
    return this.pow();
  }
  private pow(): Node {
    const base = this.primary();
    if (this.isOp('^')) {
      this.take();
      this.enter();
      const exp = this.unary();
      this.leave();
      return { type: 'binary', op: '^', left: base, right: exp };
    }
    return base;
  }
  private primary(): Node {
    const t = this.take();
    if (t.t === 'num') return { type: 'num', value: t.v };
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.take();
        const name = t.v.toLowerCase();
        const fn = FUNCTIONS[name];
        if (!fn) throw syntax(`Unknown function "${t.v}".`);
        const args: Node[] = [];
        this.enter();
        if (!this.isOp(')')) {
          args.push(this.or());
          while (this.isOp(',')) {
            this.take();
            args.push(this.or());
          }
        }
        this.leave();
        this.expectOp(')');
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
          const exp = fn.arity[0] === fn.arity[1] ? `${fn.arity[0]}` : `${fn.arity[0]}–${fn.arity[1]}`;
          throw syntax(`Function ${name}() expects ${exp} argument(s), received ${args.length}.`);
        }
        return { type: 'call', name, args };
      }
      const lower = t.v.toLowerCase();
      if (lower in CONSTANTS && !/[A-Z]/.test(t.v.slice(1))) return { type: 'num', value: CONSTANTS[lower] };
      return { type: 'var', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      this.enter();
      const n = this.or();
      this.leave();
      this.expectOp(')');
      return n;
    }
    if (t.t === 'eof') throw syntax('Expression ended unexpectedly.');
    throw syntax(`Unexpected "${t.v}" at position ${t.pos + 1}.`);
  }
}

export function parseExpression(src: string): Node {
  if (typeof src !== 'string' || !src.trim()) throw syntax('Expression is empty.');
  if (src.length > MAX_EXPRESSION_LENGTH) throw syntax(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters.`);
  return new Parser(tokenize(src)).parse();
}

/** Names of all variables referenced by an expression. */
export function referencedVariables(node: Node, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'var':
      out.add(node.name);
      break;
    case 'unary':
      referencedVariables(node.arg, out);
      break;
    case 'binary':
      referencedVariables(node.left, out);
      referencedVariables(node.right, out);
      break;
    case 'call':
      node.args.forEach((a) => referencedVariables(a, out));
      break;
  }
  return out;
}

export type CompiledFn = (values: ArrayLike<number>) => number;

/**
 * Compile an AST into a fast closure. `index` maps variable names to positions
 * in the values array passed at evaluation time.
 */
export function compile(node: Node, index: Map<string, number>): CompiledFn {
  switch (node.type) {
    case 'num': {
      const v = node.value;
      return () => v;
    }
    case 'var': {
      const i = index.get(node.name);
      if (i === undefined) throw new EngineError([{ code: 'unknown-variable', message: `Unknown variable "${node.name}".` }]);
      return (vals) => vals[i];
    }
    case 'unary': {
      const a = compile(node.arg, index);
      return node.op === '-' ? (v) => -a(v) : (v) => (a(v) === 0 ? 1 : 0);
    }
    case 'binary': {
      const l = compile(node.left, index);
      const r = compile(node.right, index);
      switch (node.op) {
        case '+': return (v) => l(v) + r(v);
        case '-': return (v) => l(v) - r(v);
        case '*': return (v) => l(v) * r(v);
        case '/': return (v) => l(v) / r(v);
        case '%': return (v) => l(v) % r(v);
        case '^': return (v) => Math.pow(l(v), r(v));
        case '<': return (v) => (l(v) < r(v) ? 1 : 0);
        case '<=': return (v) => (l(v) <= r(v) ? 1 : 0);
        case '>': return (v) => (l(v) > r(v) ? 1 : 0);
        case '>=': return (v) => (l(v) >= r(v) ? 1 : 0);
        case '==': return (v) => (l(v) === r(v) ? 1 : 0);
        case '!=': return (v) => (l(v) !== r(v) ? 1 : 0);
        case '&&': return (v) => (l(v) !== 0 && r(v) !== 0 ? 1 : 0);
        case '||': return (v) => (l(v) !== 0 || r(v) !== 0 ? 1 : 0);
      }
      throw syntax(`Unsupported operator ${node.op}.`);
    }
    case 'call': {
      const f = FUNCTIONS[node.name].fn;
      const args = node.args.map((a) => compile(a, index));
      if (node.name === 'if') {
        const [c, a, b] = args;
        return (v) => (c(v) !== 0 ? a(v) : b(v));
      }
      if (args.length === 1) {
        const [a] = args;
        return (v) => f(a(v));
      }
      if (args.length === 2) {
        const [a, b] = args;
        return (v) => f(a(v), b(v));
      }
      return (v) => f(...args.map((a) => a(v)));
    }
  }
}

/** Convenience: parse, check variables and evaluate once against a scope object. */
export function evaluate(src: string, scope: Record<string, number> = {}): number {
  const node = parseExpression(src);
  const names = Object.keys(scope);
  const index = new Map(names.map((n, i) => [n, i]));
  return compile(node, index)(names.map((n) => scope[n]));
}

/** Render an AST back to a normalised string (used in explanations). */
export function printExpression(node: Node): string {
  switch (node.type) {
    case 'num':
      return String(node.value);
    case 'var':
      return node.name;
    case 'unary':
      return node.op === '-' ? `−${wrap(node.arg)}` : `not ${wrap(node.arg)}`;
    case 'binary': {
      const op = node.op === '&&' ? 'and' : node.op === '||' ? 'or' : node.op;
      return `${wrap(node.left)} ${op} ${wrap(node.right)}`;
    }
    case 'call':
      return `${node.name}(${node.args.map(printExpression).join(', ')})`;
  }
}

function wrap(n: Node): string {
  return n.type === 'binary' ? `(${printExpression(n)})` : printExpression(n);
}

/**
 * Topologically order derived definitions (name → expression) so each is
 * evaluated after the variables it depends on. Detects cycles.
 */
export function topologicalOrder(defs: { name: string; deps: Set<string> }[]): string[] {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (name: string, path: string[]) => {
    const s = state.get(name) ?? 0;
    if (s === 2) return;
    if (s === 1) {
      throw new EngineError([
        { code: 'cycle', message: `Circular dependency: ${[...path.slice(path.indexOf(name)), name].join(' → ')}.` },
      ]);
    }
    state.set(name, 1);
    const def = byName.get(name);
    if (def) for (const d of def.deps) if (byName.has(d)) visit(d, [...path, name]);
    state.set(name, 2);
    order.push(name);
  };
  for (const d of defs) visit(d.name, []);
  return order;
}
