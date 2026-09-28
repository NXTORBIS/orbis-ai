/**
 * Mathematical expressions, as a tree rather than a string.
 *
 * `calculate.ts` already turns a typed sum into a number, and it does that well: tokenise, shunting-yard, evaluate, done.
 * What it cannot do is hold onto the expression afterwards. `x^2 + 3x + 2` has no value until `x` does, and a Page that
 * wants to differentiate it, solve it, plot it, substitute into it, or work out which cells depend on it needs the
 * *structure* and not the answer. That is what this is for.
 *
 * So: a tokeniser, a precedence-climbing parser, and a tree. Then evaluation against a scope, symbolic differentiation,
 * simplification, substitution and rendering back to text over that tree.
 *
 * No `eval`, no `new Function`, no language model. An expression Orbis cannot parse is refused with the position it gave
 * up at, and a refusal is a better answer than a number that might be wrong.
 *
 * Pure. No network, no clock, no storage.
 */

// ---------------------------------------------------------------- the tree

export type Expression =
  | { kind: 'number'; value: number }
  /** A variable or a named constant. Which one it is depends on the scope it is evaluated against. */
  | { kind: 'symbol'; name: string }
  | { kind: 'unary'; op: '-' | '+'; operand: Expression }
  | { kind: 'binary'; op: BinaryOperator; left: Expression; right: Expression }
  | { kind: 'call'; name: string; args: Expression[] }

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '%'

export const num = (value: number): Expression => ({ kind: 'number', value })
export const sym = (name: string): Expression => ({ kind: 'symbol', name })
export const call = (name: string, ...args: Expression[]): Expression => ({ kind: 'call', name, args })
export const binary = (op: BinaryOperator, left: Expression, right: Expression): Expression => ({ kind: 'binary', op, left, right })
export const negate = (operand: Expression): Expression => ({ kind: 'unary', op: '-', operand })

export const ZERO = num(0)
export const ONE = num(1)

/** Whether a node is a specific number, which most simplification rules ask. */
export const isNumber = (node: Expression, value?: number): boolean =>
  node.kind === 'number' && (value === undefined || node.value === value)

// ---------------------------------------------------------------- what the language contains

/** The named constants. A scope may shadow any of them, because a Page is allowed to call its own variable `e`. */
export const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  Infinity: Number.POSITIVE_INFINITY
}

export interface FunctionDefinition {
  /** How many arguments. A range for the ones that take an optional second, like `log`. */
  arity: number | [number, number]
  apply(...args: number[]): number
  /** Where the function is undefined, so a domain error is a message rather than a NaN. */
  domain?(...args: number[]): string | null
  description: string
}

const fn = (arity: number | [number, number], apply: (...args: number[]) => number, description: string, domain?: (...args: number[]) => string | null): FunctionDefinition => ({ arity, apply, description, domain })

/** The functions an expression may call. Anything not here is refused at parse time, not at evaluation time. */
export const FUNCTIONS: Record<string, FunctionDefinition> = {
  sqrt: fn(1, Math.sqrt, 'square root', (x) => (x < 0 ? 'The square root of a negative number is not a real number.' : null)),
  cbrt: fn(1, Math.cbrt, 'cube root'),
  abs: fn(1, Math.abs, 'absolute value'),
  sign: fn(1, Math.sign, 'sign'),
  exp: fn(1, Math.exp, 'e raised to a power'),
  ln: fn(1, Math.log, 'natural logarithm', (x) => (x <= 0 ? 'A logarithm needs a number greater than zero.' : null)),
  log: fn([1, 2], (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)), 'logarithm, base ten unless a base is given', (x, base) =>
    x <= 0 ? 'A logarithm needs a number greater than zero.' : base !== undefined && base <= 0 ? 'A logarithm base must be greater than zero.' : null
  ),
  log2: fn(1, Math.log2, 'logarithm base two', (x) => (x <= 0 ? 'A logarithm needs a number greater than zero.' : null)),
  sin: fn(1, Math.sin, 'sine, in radians'),
  cos: fn(1, Math.cos, 'cosine, in radians'),
  tan: fn(1, Math.tan, 'tangent, in radians'),
  asin: fn(1, Math.asin, 'inverse sine', (x) => (x < -1 || x > 1 ? 'The inverse sine needs a number between -1 and 1.' : null)),
  acos: fn(1, Math.acos, 'inverse cosine', (x) => (x < -1 || x > 1 ? 'The inverse cosine needs a number between -1 and 1.' : null)),
  atan: fn(1, Math.atan, 'inverse tangent'),
  atan2: fn(2, Math.atan2, 'the angle of a point, from its two coordinates'),
  sinh: fn(1, Math.sinh, 'hyperbolic sine'),
  cosh: fn(1, Math.cosh, 'hyperbolic cosine'),
  tanh: fn(1, Math.tanh, 'hyperbolic tangent'),
  floor: fn(1, Math.floor, 'round down'),
  ceil: fn(1, Math.ceil, 'round up'),
  round: fn([1, 2], (x, places) => (places === undefined ? Math.round(x) : Number(x.toFixed(Math.min(20, Math.max(0, Math.round(places)))))), 'round'),
  min: fn([1, 8], (...args) => Math.min(...args), 'the smallest of its arguments'),
  max: fn([1, 8], (...args) => Math.max(...args), 'the largest of its arguments'),
  hypot: fn([2, 8], (...args) => Math.hypot(...args), 'the length of a vector from its components')
}

/**
 * A lookup that cannot be answered by `Object.prototype`.
 *
 * `FUNCTIONS['constructor']` on a plain object returns the Object constructor, which is truthy -- so a guard written as
 * `if (!FUNCTIONS[name])` lets `constructor(1)` through, and whatever happens next happens with a function where a
 * definition was expected. Every table in this file is indexed by a name that came from somebody's typing, so every one
 * of them is read through here.
 */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined

const arityOf = (definition: FunctionDefinition): [number, number] =>
  typeof definition.arity === 'number' ? [definition.arity, definition.arity] : definition.arity

// ---------------------------------------------------------------- parsing

export interface ParseError {
  error: 'syntax' | 'unknown-function' | 'arity' | 'empty'
  message: string
  /** Where in the input it gave up, so a Page can underline the character rather than the whole box. */
  at: number
}

export const isParseError = (value: Expression | ParseError): value is ParseError => 'error' in value

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'name'; value: string; at: number }
  | { kind: 'op'; value: string; at: number }

/** The characters people type, made into the ones the parser knows. */
function tidy(input: string): string {
  return String(input ?? '')
    .replace(/[×✕✖⋅·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/−/g, '-')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/≡|≈/g, '=')
}

function tokenise(text: string): Token[] | ParseError {
  const tokens: Token[] = []
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (/\s/.test(char)) {
      at += 1
      continue
    }
    // A number, including a decimal point and scientific notation. `1e-3` is one token, not three.
    const number = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(at))
    if (number && /[\d.]/.test(char)) {
      tokens.push({ kind: 'number', value: Number(number[0]), at })
      at += number[0].length
      continue
    }
    const name = /^[A-Za-z_α-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω]*/.exec(text.slice(at))
    if (name) {
      tokens.push({ kind: 'name', value: name[0], at })
      at += name[0].length
      continue
    }
    if ('+-*/^%(),'.includes(char)) {
      tokens.push({ kind: 'op', value: char, at })
      at += 1
      continue
    }
    return { error: 'syntax', message: `"${char}" is not something an expression can contain.`, at }
  }
  return tokens
}

const PRECEDENCE: Record<BinaryOperator, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4 }
/** Exponentiation groups to the right: `2^3^2` is `2^9`, not `8^2`. */
const RIGHT_ASSOCIATIVE = new Set<BinaryOperator>(['^'])
/** Unary minus binds tighter than multiplication and looser than a power, so `-x^2` is `-(x^2)`. */
const UNARY_PRECEDENCE = 3

/**
 * An expression as written, parsed into a tree.
 *
 * Understands implicit multiplication -- `2x`, `3(x+1)`, `2sin(x)`, `(x+1)(x-1)` -- because that is how mathematics is
 * written everywhere except in programming languages.
 *
 * Two adjacent letters are one name, not a product: `xy` is a variable called `xy` and not `x*y`. That is the deliberate
 * choice, because a scientific Page needs to call a variable `mass` or `velocity`, and a parser that split identifiers
 * into single letters would make that impossible. Somebody who means the product writes `x*y`, and `variablesOf` reports
 * whatever the parse actually produced, so a misreading is visible rather than silent.
 */
export function parseExpression(input: string): Expression | ParseError {
  const text = tidy(input).trim()
  if (text === '') return { error: 'empty', message: 'There is no expression here.', at: 0 }

  const tokens = tokenise(text)
  if ('error' in tokens) return tokens
  if (tokens.length === 0) return { error: 'empty', message: 'There is no expression here.', at: 0 }

  let index = 0
  const peek = (): Token | undefined => tokens[index]
  const endAt = (): number => peek()?.at ?? text.length

  const parseBinary = (minimum: number): Expression | ParseError => {
    let left = parseUnary()
    if (isParseError(left)) return left
    for (;;) {
      const token = peek()
      if (!token) break
      // An implicit `*`: a value immediately followed by another value.
      if (token.kind === 'number' || token.kind === 'name' || (token.kind === 'op' && token.value === '(')) {
        if (PRECEDENCE['*'] < minimum) break
        const right = parseBinary(PRECEDENCE['*'] + 1)
        if (isParseError(right)) return right
        left = binary('*', left, right)
        continue
      }
      if (token.kind !== 'op' || !(token.value in PRECEDENCE)) break
      const op = token.value as BinaryOperator
      const precedence = PRECEDENCE[op]
      if (precedence < minimum) break
      index += 1
      const next = RIGHT_ASSOCIATIVE.has(op) ? precedence : precedence + 1
      const right = parseBinary(next)
      if (isParseError(right)) return right
      left = binary(op, left, right)
    }
    return left
  }

  function parseUnary(): Expression | ParseError {
    const token = peek()
    if (token?.kind === 'op' && (token.value === '-' || token.value === '+')) {
      index += 1
      const operand = parseBinary(UNARY_PRECEDENCE)
      if (isParseError(operand)) return operand
      return token.value === '-' ? negate(operand) : operand
    }
    return parseAtom()
  }

  function parseAtom(): Expression | ParseError {
    const token = peek()
    if (!token) return { error: 'syntax', message: 'The expression ends where a value was expected.', at: text.length }

    if (token.kind === 'number') {
      index += 1
      return num(token.value)
    }

    if (token.kind === 'name') {
      index += 1
      const after = peek()
      if (after?.kind === 'op' && after.value === '(') {
        const definition = own(FUNCTIONS, token.value)
        if (!definition) {
          return { error: 'unknown-function', message: `Orbis has no function called "${token.value}".`, at: token.at }
        }
        index += 1
        const args: Expression[] = []
        if (peek()?.kind === 'op' && (peek() as { value: string }).value === ')') {
          index += 1
        } else {
          for (;;) {
            const arg = parseBinary(1)
            if (isParseError(arg)) return arg
            args.push(arg)
            const separator = peek()
            if (separator?.kind === 'op' && separator.value === ',') {
              index += 1
              continue
            }
            if (separator?.kind === 'op' && separator.value === ')') {
              index += 1
              break
            }
            return { error: 'syntax', message: `"${token.value}" has an argument list that is not closed.`, at: endAt() }
          }
        }
        const [least, most] = arityOf(definition)
        if (args.length < least || args.length > most) {
          const wanted = least === most ? `${least}` : `${least} to ${most}`
          return {
            error: 'arity',
            message: `"${token.value}" takes ${wanted} argument${most === 1 ? '' : 's'}, not ${args.length}.`,
            at: token.at
          }
        }
        return call(token.value, ...args)
      }
      return sym(token.value)
    }

    if (token.value === '(') {
      index += 1
      const inner = parseBinary(1)
      if (isParseError(inner)) return inner
      const closing = peek()
      if (!(closing?.kind === 'op' && closing.value === ')')) {
        return { error: 'syntax', message: 'A bracket was opened and never closed.', at: endAt() }
      }
      index += 1
      return inner
    }

    return { error: 'syntax', message: `"${token.value}" cannot start a value.`, at: token.at }
  }

  const parsed = parseBinary(1)
  if (isParseError(parsed)) return parsed
  const leftover = peek()
  if (leftover) return { error: 'syntax', message: `"${text.slice(leftover.at)}" is left over at the end.`, at: leftover.at }
  return parsed
}

// ---------------------------------------------------------------- reading a tree

/** Every symbol the expression mentions, in the order first seen. Named constants are excluded unless asked for. */
export function variablesOf(node: Expression, includeConstants = false): string[] {
  const found: string[] = []
  const walk = (current: Expression): void => {
    switch (current.kind) {
      case 'number':
        return
      case 'symbol':
        if (!includeConstants && own(CONSTANTS, current.name) !== undefined) return
        if (!found.includes(current.name)) found.push(current.name)
        return
      case 'unary':
        return walk(current.operand)
      case 'binary':
        walk(current.left)
        return walk(current.right)
      case 'call':
        for (const arg of current.args) walk(arg)
        return
    }
  }
  walk(node)
  return found
}

/** Every function the expression calls. For a capability check: a Page can be told what an expression needs. */
export function functionsOf(node: Expression): string[] {
  const found: string[] = []
  const walk = (current: Expression): void => {
    if (current.kind === 'call') {
      if (!found.includes(current.name)) found.push(current.name)
      for (const arg of current.args) walk(arg)
    } else if (current.kind === 'binary') {
      walk(current.left)
      walk(current.right)
    } else if (current.kind === 'unary') {
      walk(current.operand)
    }
  }
  walk(node)
  return found
}

/** How deep the tree is. A guard: an expression built by a generator can be arbitrarily nested. */
export function depthOf(node: Expression): number {
  switch (node.kind) {
    case 'number':
    case 'symbol':
      return 1
    case 'unary':
      return 1 + depthOf(node.operand)
    case 'binary':
      return 1 + Math.max(depthOf(node.left), depthOf(node.right))
    case 'call':
      return 1 + Math.max(0, ...node.args.map(depthOf))
  }
}

/** How many nodes the tree has. The other half of the guard -- a wide tree is as expensive as a deep one. */
export function sizeOf(node: Expression): number {
  switch (node.kind) {
    case 'number':
    case 'symbol':
      return 1
    case 'unary':
      return 1 + sizeOf(node.operand)
    case 'binary':
      return 1 + sizeOf(node.left) + sizeOf(node.right)
    case 'call':
      return 1 + node.args.reduce((total, arg) => total + sizeOf(arg), 0)
  }
}

/** Whether two trees are the same shape. Used by simplification, and by tests that care about structure. */
export function sameExpression(a: Expression, b: Expression): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'number':
      return a.value === (b as typeof a).value
    case 'symbol':
      return a.name === (b as typeof a).name
    case 'unary':
      return a.op === (b as typeof a).op && sameExpression(a.operand, (b as typeof a).operand)
    case 'binary':
      return (
        a.op === (b as typeof a).op &&
        sameExpression(a.left, (b as typeof a).left) &&
        sameExpression(a.right, (b as typeof a).right)
      )
    case 'call': {
      const other = b as typeof a
      return a.name === other.name && a.args.length === other.args.length && a.args.every((arg, i) => sameExpression(arg, other.args[i]))
    }
  }
}

// ---------------------------------------------------------------- evaluation

export interface EvaluateError {
  error: 'unknown-symbol' | 'domain' | 'not-finite' | 'too-deep'
  message: string
  /** The symbol that had no value, when that was the problem. */
  symbol?: string
}

export const isEvaluateError = (value: unknown): value is EvaluateError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/** The most nesting an expression may have before evaluation refuses. Generous for a person, bounded for a generator. */
export const MAX_DEPTH = 256

/**
 * An expression's value, given values for its symbols.
 *
 * Every failure is a reason rather than a `NaN`: an unknown symbol names itself, a domain error says what the function
 * needed, and a result that is not finite is refused rather than handed onward to be plotted as a gap.
 */
export function evaluateExpression(node: Expression, scope: Record<string, number> = {}): number | EvaluateError {
  if (depthOf(node) > MAX_DEPTH) {
    return { error: 'too-deep', message: 'That expression is nested too deeply to evaluate.' }
  }

  const walk = (current: Expression): number | EvaluateError => {
    switch (current.kind) {
      case 'number':
        return current.value
      case 'symbol': {
        // The scope wins over a named constant, so a Page may legitimately have a variable called `e`.
        const value = Object.prototype.hasOwnProperty.call(scope, current.name) ? scope[current.name] : own(CONSTANTS, current.name)
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) return value
          return { error: 'unknown-symbol', message: `"${current.name}" has no value.`, symbol: current.name }
        }
        return value
      }
      case 'unary': {
        const operand = walk(current.operand)
        if (isEvaluateError(operand)) return operand
        return current.op === '-' ? -operand : operand
      }
      case 'binary': {
        const left = walk(current.left)
        if (isEvaluateError(left)) return left
        const right = walk(current.right)
        if (isEvaluateError(right)) return right
        switch (current.op) {
          case '+':
            return left + right
          case '-':
            return left - right
          case '*':
            return left * right
          case '/':
            if (right === 0) return { error: 'domain', message: 'Division by zero.' }
            return left / right
          case '%':
            if (right === 0) return { error: 'domain', message: 'A remainder needs a divisor other than zero.' }
            return left % right
          case '^': {
            // A negative base with a fractional exponent has no real value, and `NaN` is not an answer.
            if (left < 0 && !Number.isInteger(right)) {
              return { error: 'domain', message: 'A negative number raised to a fractional power is not a real number.' }
            }
            if (left === 0 && right < 0) return { error: 'domain', message: 'Zero raised to a negative power is not defined.' }
            return Math.pow(left, right)
          }
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'call': {
        const definition = own(FUNCTIONS, current.name)
        if (!definition) return { error: 'unknown-symbol', message: `Orbis has no function called "${current.name}".`, symbol: current.name }
        const args: number[] = []
        for (const arg of current.args) {
          const value = walk(arg)
          if (isEvaluateError(value)) return value
          args.push(value)
        }
        const complaint = definition.domain?.(...args)
        if (complaint) return { error: 'domain', message: complaint }
        const result = definition.apply(...args)
        if (!Number.isFinite(result)) {
          return { error: 'not-finite', message: `"${current.name}" has no finite value there.` }
        }
        return result
      }
    }
  }

  const result = walk(node)
  if (isEvaluateError(result)) return result
  if (!Number.isFinite(result)) return { error: 'not-finite', message: 'That does not have a finite value.' }
  return result
}

/** Parse and evaluate in one step, for the common case. */
export function evaluate(input: string, scope: Record<string, number> = {}): number | ParseError | EvaluateError {
  const parsed = parseExpression(input)
  if (isParseError(parsed)) return parsed
  return evaluateExpression(parsed, scope)
}

// ---------------------------------------------------------------- transformation

/**
 * A symbol replaced by an expression, everywhere it appears.
 *
 * Substitution rather than evaluation: putting `y+1` in for `x` leaves an expression, and putting `3` in for `x` leaves
 * an expression that happens to be constant. Simplifying it is a separate decision.
 */
export function substitute(node: Expression, name: string, replacement: Expression): Expression {
  switch (node.kind) {
    case 'number':
      return node
    case 'symbol':
      return node.name === name ? replacement : node
    case 'unary':
      return { kind: 'unary', op: node.op, operand: substitute(node.operand, name, replacement) }
    case 'binary':
      return binary(node.op, substitute(node.left, name, replacement), substitute(node.right, name, replacement))
    case 'call':
      return call(node.name, ...node.args.map((arg) => substitute(arg, name, replacement)))
  }
}

/**
 * An expression made smaller without being made different.
 *
 * Constant folding plus the identities that always hold: `x+0`, `x*1`, `x*0`, `x^1`, `x^0`, `x/1`, `--x`. Nothing here is
 * conditionally true -- `sqrt(x^2)` is deliberately left alone, because it is `|x|` and not `x`, and a simplifier that
 * quietly changes a domain is worse than one that does nothing.
 *
 * Runs to a fixed point, bounded, because one rule firing can expose another.
 */
export function simplify(node: Expression, rounds = 12): Expression {
  let current = once(node)
  for (let i = 1; i < rounds; i++) {
    const next = once(current)
    if (sameExpression(next, current)) return next
    current = next
  }
  return current
}

function once(node: Expression): Expression {
  switch (node.kind) {
    case 'number':
    case 'symbol':
      return node

    case 'unary': {
      const operand = once(node.operand)
      if (node.op === '+') return operand
      if (operand.kind === 'number') return num(-operand.value)
      // Two minus signs cancel.
      if (operand.kind === 'unary' && operand.op === '-') return operand.operand
      return { kind: 'unary', op: '-', operand }
    }

    case 'call': {
      const args = node.args.map(once)
      // A call on constants is a constant -- but only when it actually has a finite value there.
      if (args.every((arg) => arg.kind === 'number')) {
        const value = evaluateExpression(call(node.name, ...args))
        if (!isEvaluateError(value)) return num(value)
      }
      return call(node.name, ...args)
    }

    case 'binary': {
      const left = once(node.left)
      const right = once(node.right)

      if (left.kind === 'number' && right.kind === 'number') {
        const value = evaluateExpression(binary(node.op, left, right))
        if (!isEvaluateError(value)) return num(value)
      }

      switch (node.op) {
        case '+':
          if (isNumber(left, 0)) return right
          if (isNumber(right, 0)) return left
          // `a + -b` reads better as `a - b`.
          if (right.kind === 'unary' && right.op === '-') return binary('-', left, right.operand)
          break
        case '-':
          if (isNumber(right, 0)) return left
          if (isNumber(left, 0)) return negate(right)
          // `a - a` is zero whatever `a` is.
          if (sameExpression(left, right)) return ZERO
          break
        case '*': {
          if (isNumber(left, 0) || isNumber(right, 0)) return ZERO
          if (isNumber(left, 1)) return right
          if (isNumber(right, 1)) return left
          if (isNumber(left, -1)) return negate(right)
          if (isNumber(right, -1)) return negate(left)
          // Two minus signs cancel across a product; one moves outside it.
          const leftNegated = left.kind === 'unary' && left.op === '-'
          const rightNegated = right.kind === 'unary' && right.op === '-'
          if (leftNegated && rightNegated) return binary('*', left.operand, right.operand)
          if (leftNegated) return negate(binary('*', left.operand, right))
          if (rightNegated) return negate(binary('*', left, right.operand))
          // A number belongs on the left, so `x*2` and `2*x` reach the same shape.
          if (right.kind === 'number' && left.kind !== 'number') return binary('*', right, left)
          break
        }
        case '/': {
          if (isNumber(right, 1)) return left
          if (isNumber(left, 0) && !isNumber(right, 0)) return ZERO
          // `a / a` is one -- except at zero, where the original was undefined too, so nothing is gained or lost.
          if (sameExpression(left, right)) return ONE
          // The same cancellation as a product: `-F / -m` is `F / m`, which is what a rearranged formula should read as.
          const leftNegated = left.kind === 'unary' && left.op === '-'
          const rightNegated = right.kind === 'unary' && right.op === '-'
          if (leftNegated && rightNegated) return binary('/', left.operand, right.operand)
          if (leftNegated) return negate(binary('/', left.operand, right))
          if (rightNegated) return negate(binary('/', left, right.operand))
          break
        }
        case '^':
          if (isNumber(right, 1)) return left
          // `x^0` is 1 for every x this engine can evaluate: `0^0` is refused by evaluation anyway.
          if (isNumber(right, 0)) return ONE
          if (isNumber(left, 1)) return ONE
          break
      }

      return binary(node.op, left, right)
    }
  }
}

export interface DifferentiateError {
  error: 'not-differentiable'
  message: string
  /** The function that has no rule here. */
  what: string
}

const DERIVATIVES: Record<string, (arg: Expression) => Expression | null> = {
  sin: (x) => call('cos', x),
  cos: (x) => negate(call('sin', x)),
  tan: (x) => binary('/', ONE, binary('^', call('cos', x), num(2))),
  exp: (x) => call('exp', x),
  ln: (x) => binary('/', ONE, x),
  log: (x) => binary('/', ONE, binary('*', x, call('ln', num(10)))),
  log2: (x) => binary('/', ONE, binary('*', x, call('ln', num(2)))),
  sqrt: (x) => binary('/', ONE, binary('*', num(2), call('sqrt', x))),
  sinh: (x) => call('cosh', x),
  cosh: (x) => call('sinh', x),
  tanh: (x) => binary('-', ONE, binary('^', call('tanh', x), num(2))),
  asin: (x) => binary('/', ONE, call('sqrt', binary('-', ONE, binary('^', x, num(2))))),
  acos: (x) => negate(binary('/', ONE, call('sqrt', binary('-', ONE, binary('^', x, num(2)))))),
  atan: (x) => binary('/', ONE, binary('+', ONE, binary('^', x, num(2)))),
  // Deliberately absent: abs, sign, floor, ceil, round, min, max. They are not differentiable everywhere, and returning
  // a derivative that is wrong at the interesting point is worse than saying so.
  cbrt: (x) => binary('/', ONE, binary('*', num(3), binary('^', call('cbrt', x), num(2))))
}

/**
 * The derivative with respect to one variable, worked out symbolically.
 *
 * Product, quotient, chain and power rules, and the functions with a rule in `DERIVATIVES`. A function without one is
 * refused by name rather than approximated: a numerical derivative is a different thing with a different error, and a
 * caller that wants one should ask for one.
 *
 * The result is simplified, because an unsimplified derivative of anything real is unreadable.
 */
export function differentiate(node: Expression, variable: string): Expression | DifferentiateError {
  const d = (current: Expression): Expression | DifferentiateError => {
    switch (current.kind) {
      case 'number':
        return ZERO
      case 'symbol':
        // A named constant differentiates to zero; so does any other variable.
        return current.name === variable ? ONE : ZERO
      case 'unary': {
        const inner = d(current.operand)
        if ('error' in inner) return inner
        return current.op === '-' ? negate(inner) : inner
      }
      case 'binary': {
        const { left, right } = current
        switch (current.op) {
          case '+':
          case '-': {
            const a = d(left)
            if ('error' in a) return a
            const b = d(right)
            if ('error' in b) return b
            return binary(current.op, a, b)
          }
          case '*': {
            const a = d(left)
            if ('error' in a) return a
            const b = d(right)
            if ('error' in b) return b
            return binary('+', binary('*', a, right), binary('*', left, b))
          }
          case '/': {
            const a = d(left)
            if ('error' in a) return a
            const b = d(right)
            if ('error' in b) return b
            return binary(
              '/',
              binary('-', binary('*', a, right), binary('*', left, b)),
              binary('^', right, num(2))
            )
          }
          case '^': {
            const exponentIsConstant = !variablesOf(right).includes(variable)
            const baseIsConstant = !variablesOf(left).includes(variable)
            if (exponentIsConstant) {
              // The power rule, with the chain rule over the base.
              const inner = d(left)
              if ('error' in inner) return inner
              return binary('*', binary('*', right, binary('^', left, binary('-', right, ONE))), inner)
            }
            if (baseIsConstant) {
              // a^u differentiates to a^u ln(a) u'.
              const inner = d(right)
              if ('error' in inner) return inner
              return binary('*', binary('*', binary('^', left, right), call('ln', left)), inner)
            }
            // Both depend on the variable, so go through the exponential form: u^v = exp(v ln u).
            const rewritten = call('exp', binary('*', right, call('ln', left)))
            return d(rewritten)
          }
          case '%':
            return { error: 'not-differentiable', message: 'A remainder has no derivative Orbis will claim.', what: '%' }
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'call': {
        const rule = own(DERIVATIVES, current.name)
        if (!rule || current.args.length !== 1) {
          return {
            error: 'not-differentiable',
            message: `Orbis has no derivative for "${current.name}".`,
            what: current.name
          }
        }
        const outer = rule(current.args[0])
        if (!outer) return { error: 'not-differentiable', message: `Orbis has no derivative for "${current.name}".`, what: current.name }
        const inner = d(current.args[0])
        if ('error' in inner) return inner
        return binary('*', outer, inner)
      }
    }
  }

  const result = d(node)
  if ('error' in result) return result
  return simplify(result)
}

// ---------------------------------------------------------------- writing a tree back out

const NEEDS_BRACKETS: Record<BinaryOperator, number> = PRECEDENCE

/**
 * An expression as text, with the brackets it needs and no others.
 *
 * Round-trips: parsing the output gives back the same tree. That is checked by a test rather than assumed, because the
 * bracket rules are exactly the kind of thing that is nearly right.
 */
export function expressionToText(node: Expression): string {
  const write = (current: Expression, parentPrecedence: number, isRightOfSameLevel = false): string => {
    switch (current.kind) {
      case 'number': {
        // Keep it short but exact enough to round-trip.
        const text = String(current.value)
        return current.value < 0 && parentPrecedence > 0 ? `(${text})` : text
      }
      case 'symbol':
        return current.name
      case 'unary': {
        const inner = write(current.operand, UNARY_PRECEDENCE)
        const text = `${current.op}${inner}`
        return parentPrecedence > UNARY_PRECEDENCE ? `(${text})` : text
      }
      case 'call':
        return `${current.name}(${current.args.map((arg) => write(arg, 0)).join(', ')})`
      case 'binary': {
        const precedence = NEEDS_BRACKETS[current.op]
        const left = write(current.left, precedence)
        // The right side of a left-associative operator needs brackets at equal precedence: a-(b-c) is not a-b-c.
        const right = write(current.right, RIGHT_ASSOCIATIVE.has(current.op) ? precedence : precedence + 1, true)
        void isRightOfSameLevel
        const op = current.op === '^' ? '^' : ` ${current.op} `
        const text = `${left}${op}${right}`
        return parentPrecedence > precedence ? `(${text})` : text
      }
    }
  }
  return write(node, 0)
}

/** A short description of what an expression is, for a Page that wants to label it. */
export function describeExpression(node: Expression): string {
  const variables = variablesOf(node)
  if (variables.length === 0) return 'a constant'
  if (variables.length === 1) return `a function of ${variables[0]}`
  return `a function of ${variables.slice(0, -1).join(', ')} and ${variables[variables.length - 1]}`
}
