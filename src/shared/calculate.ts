/**
 * Sums and conversions, worked out exactly (§40, §41).
 *
 * "25 × 48" has one right answer and it does not require a language model to find it. Asking one is slower, costs
 * money, and -- the part that matters -- can be wrong in a way that looks exactly like being right. A calculator that
 * is occasionally confidently incorrect is worse than no calculator, because nobody checks a number in a box.
 *
 * So this is an actual parser and an actual evaluator: tokenise, shunting-yard into postfix, evaluate. No `eval`, no
 * `new Function`, no model. Anything it cannot parse it refuses, and a refusal means the page simply shows search
 * results instead -- which is the correct outcome for something that was never a sum.
 *
 * Conversions are the same idea with a table of factors. Currency is deliberately absent: a rate is a fact about today
 * that has to be fetched, and inventing one is exactly the kind of confident wrongness this file exists to avoid.
 */

export interface Calculated {
  /** The expression as it was understood, so somebody can see it was read the way they meant it. */
  expression: string
  value: number
  /** Formatted for reading: grouped thousands, sensible precision. */
  display: string
}

export interface Converted {
  value: number
  display: string
  from: { value: number; unit: string }
  to: { unit: string }
}

type Token = { kind: 'number'; value: number } | { kind: 'op'; value: string } | { kind: 'paren'; value: '(' | ')' } | { kind: 'fn'; value: string }

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan
}

/** Precedence, and which way equal precedence groups. Exponentiation is right-associative: 2^3^2 is 2^9, not 8^2. */
const OPS: Record<string, { precedence: number; rightAssociative?: boolean; apply(a: number, b: number): number }> = {
  '+': { precedence: 1, apply: (a, b) => a + b },
  '-': { precedence: 1, apply: (a, b) => a - b },
  '*': { precedence: 2, apply: (a, b) => a * b },
  '/': { precedence: 2, apply: (a, b) => a / b },
  '%': { precedence: 2, apply: (a, b) => a % b },
  '^': { precedence: 3, rightAssociative: true, apply: (a, b) => a ** b }
}

/** The characters people actually type, made into the ones the parser knows. */
const tidy = (input: string): string =>
  String(input ?? '')
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const s = input
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') { i += 1; continue }
    if (/[0-9.]/.test(c)) {
      const match = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i))
      if (!match) return null
      tokens.push({ kind: 'number', value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if (/[a-z]/i.test(c)) {
      const match = /^[a-z]+/i.exec(s.slice(i))!
      const name = match[0].toLowerCase()
      if (name === 'pi') tokens.push({ kind: 'number', value: Math.PI })
      else if (name === 'e') tokens.push({ kind: 'number', value: Math.E })
      else if (FUNCTIONS[name]) tokens.push({ kind: 'fn', value: name })
      else return null
      i += match[0].length
      continue
    }
    if (c === '(' || c === ')') { tokens.push({ kind: 'paren', value: c }); i += 1; continue }
    if (OPS[c]) { tokens.push({ kind: 'op', value: c }); i += 1; continue }
    return null
  }
  return tokens.length ? tokens : null
}

/** Unary minus, turned into something the binary evaluator can handle, by reading "-x" as "0 - x". */
function insertUnaryZeros(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const previous = out[out.length - 1]
    const startsTerm = !previous || (previous.kind === 'op') || (previous.kind === 'paren' && previous.value === '(')
    if (token.kind === 'op' && (token.value === '-' || token.value === '+') && startsTerm) {
      out.push({ kind: 'number', value: 0 }, token)
      continue
    }
    out.push(token)
  }
  return out
}

/** Shunting-yard: infix to postfix, refusing anything unbalanced rather than guessing at what was meant. */
function toPostfix(tokens: Token[]): Token[] | null {
  const out: Token[] = []
  const stack: Token[] = []
  for (const token of tokens) {
    if (token.kind === 'number') { out.push(token); continue }
    if (token.kind === 'fn') { stack.push(token); continue }
    if (token.kind === 'op') {
      const me = OPS[token.value]
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.kind === 'fn') { out.push(stack.pop()!); continue }
        if (top.kind !== 'op') break
        const theirs = OPS[top.value]
        const takes = me.rightAssociative ? theirs.precedence > me.precedence : theirs.precedence >= me.precedence
        if (!takes) break
        out.push(stack.pop()!)
      }
      stack.push(token)
      continue
    }
    if (token.value === '(') { stack.push(token); continue }
    let balanced = false
    while (stack.length) {
      const top = stack.pop()!
      if (top.kind === 'paren' && top.value === '(') { balanced = true; break }
      out.push(top)
    }
    if (!balanced) return null
    if (stack[stack.length - 1]?.kind === 'fn') out.push(stack.pop()!)
  }
  while (stack.length) {
    const top = stack.pop()!
    if (top.kind === 'paren') return null
    out.push(top)
  }
  return out
}

function evaluate(postfix: Token[]): number | null {
  const stack: number[] = []
  for (const token of postfix) {
    if (token.kind === 'number') { stack.push(token.value); continue }
    if (token.kind === 'fn') {
      const x = stack.pop()
      if (x === undefined) return null
      stack.push(FUNCTIONS[token.value](x))
      continue
    }
    if (token.kind === 'op') {
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) return null
      stack.push(OPS[token.value].apply(a, b))
      continue
    }
    return null
  }
  return stack.length === 1 ? stack[0] : null
}

/** A number as somebody would write it: grouped, and only as precise as it needs to be. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString('en-US')
  if (Math.abs(value) >= 1e15 || (Math.abs(value) < 1e-6 && value !== 0)) return value.toExponential(6).replace(/\.?0+e/, 'e')
  const rounded = Number(value.toFixed(10))
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 10 })
}

/**
 * The sum, or nothing.
 *
 * Nothing is the common case and it is not a failure: most queries are not arithmetic, and the page shows results.
 * A division by zero is Infinity, which is the true answer to the question asked and is shown as such.
 */
export function calculate(input: string): Calculated | null {
  const raw = tidy(input)
  if (!raw || !/\d/.test(raw)) return null

  // "15% of 850" is the one piece of English worth understanding, because it is how people write it.
  const percentOf = /^([\d.,]+)\s*%\s*of\s*([\d.,]+)$/i.exec(raw)
  if (percentOf) {
    const part = Number(percentOf[1].replace(/,/g, ''))
    const whole = Number(percentOf[2].replace(/,/g, ''))
    if (Number.isFinite(part) && Number.isFinite(whole)) {
      const value = (part / 100) * whole
      return { expression: `${formatNumber(part)}% of ${formatNumber(whole)}`, value, display: formatNumber(value) }
    }
  }

  // Otherwise it must look like a sum and nothing else: a query with words in it is a search, not a calculation.
  if (!/^[\d\s().,+\-*/^%a-z]+$/i.test(raw)) return null
  const tokens = tokenize(raw)
  if (!tokens || !tokens.some((t) => t.kind === 'op' || t.kind === 'fn')) return null
  const postfix = toPostfix(insertUnaryZeros(tokens))
  if (!postfix) return null
  const value = evaluate(postfix)
  if (value === null || Number.isNaN(value)) return null
  return { expression: raw, value, display: formatNumber(value) }
}

// ---------------------------------------------------------------- conversions

/** Everything measurable in the same family, as a factor against one base unit. Exact where exactness exists. */
const UNITS: Record<string, { family: string; toBase: number; name: string }> = {
  // length, base metre
  mm: { family: 'length', toBase: 0.001, name: 'millimetres' },
  cm: { family: 'length', toBase: 0.01, name: 'centimetres' },
  m: { family: 'length', toBase: 1, name: 'metres' },
  km: { family: 'length', toBase: 1000, name: 'kilometres' },
  in: { family: 'length', toBase: 0.0254, name: 'inches' },
  inch: { family: 'length', toBase: 0.0254, name: 'inches' },
  inches: { family: 'length', toBase: 0.0254, name: 'inches' },
  ft: { family: 'length', toBase: 0.3048, name: 'feet' },
  feet: { family: 'length', toBase: 0.3048, name: 'feet' },
  foot: { family: 'length', toBase: 0.3048, name: 'feet' },
  yd: { family: 'length', toBase: 0.9144, name: 'yards' },
  mi: { family: 'length', toBase: 1609.344, name: 'miles' },
  mile: { family: 'length', toBase: 1609.344, name: 'miles' },
  miles: { family: 'length', toBase: 1609.344, name: 'miles' },
  // mass, base kilogram
  mg: { family: 'mass', toBase: 0.000001, name: 'milligrams' },
  g: { family: 'mass', toBase: 0.001, name: 'grams' },
  kg: { family: 'mass', toBase: 1, name: 'kilograms' },
  t: { family: 'mass', toBase: 1000, name: 'tonnes' },
  oz: { family: 'mass', toBase: 0.028349523125, name: 'ounces' },
  lb: { family: 'mass', toBase: 0.45359237, name: 'pounds' },
  lbs: { family: 'mass', toBase: 0.45359237, name: 'pounds' },
  pound: { family: 'mass', toBase: 0.45359237, name: 'pounds' },
  pounds: { family: 'mass', toBase: 0.45359237, name: 'pounds' },
  // data, base byte (1024-based, as storage is actually sold and reported)
  kb: { family: 'data', toBase: 1024, name: 'kilobytes' },
  mb: { family: 'data', toBase: 1024 ** 2, name: 'megabytes' },
  gb: { family: 'data', toBase: 1024 ** 3, name: 'gigabytes' },
  tb: { family: 'data', toBase: 1024 ** 4, name: 'terabytes' },
  // time, base second
  s: { family: 'time', toBase: 1, name: 'seconds' },
  sec: { family: 'time', toBase: 1, name: 'seconds' },
  min: { family: 'time', toBase: 60, name: 'minutes' },
  h: { family: 'time', toBase: 3600, name: 'hours' },
  hr: { family: 'time', toBase: 3600, name: 'hours' },
  hour: { family: 'time', toBase: 3600, name: 'hours' },
  hours: { family: 'time', toBase: 3600, name: 'hours' },
  day: { family: 'time', toBase: 86_400, name: 'days' },
  days: { family: 'time', toBase: 86_400, name: 'days' },
  week: { family: 'time', toBase: 604_800, name: 'weeks' },
  // speed, base metres per second
  kmh: { family: 'speed', toBase: 1 / 3.6, name: 'km/h' },
  mph: { family: 'speed', toBase: 0.44704, name: 'mph' },
  // area, base square metre
  sqm: { family: 'area', toBase: 1, name: 'square metres' },
  sqft: { family: 'area', toBase: 0.09290304, name: 'square feet' },
  acre: { family: 'area', toBase: 4046.8564224, name: 'acres' },
  hectare: { family: 'area', toBase: 10_000, name: 'hectares' },
  // volume, base litre
  ml: { family: 'volume', toBase: 0.001, name: 'millilitres' },
  l: { family: 'volume', toBase: 1, name: 'litres' },
  litre: { family: 'volume', toBase: 1, name: 'litres' },
  gal: { family: 'volume', toBase: 3.785411784, name: 'US gallons' }
}

/** Temperature is not a factor, it is a formula, so it is converted separately rather than bent into the table. */
const TEMPERATURE: Record<string, { name: string; toC(v: number): number; fromC(v: number): number }> = {
  c: { name: '°C', toC: (v) => v, fromC: (v) => v },
  celsius: { name: '°C', toC: (v) => v, fromC: (v) => v },
  f: { name: '°F', toC: (v) => ((v - 32) * 5) / 9, fromC: (v) => (v * 9) / 5 + 32 },
  fahrenheit: { name: '°F', toC: (v) => ((v - 32) * 5) / 9, fromC: (v) => (v * 9) / 5 + 32 },
  k: { name: 'K', toC: (v) => v - 273.15, fromC: (v) => v + 273.15 },
  kelvin: { name: 'K', toC: (v) => v - 273.15, fromC: (v) => v + 273.15 }
}

const unitKey = (word: string): string => word.toLowerCase().replace(/[°\s.]/g, '').replace(/\/h$/, 'h')

/**
 * A conversion, or nothing.
 *
 * Currency is not here on purpose. An exchange rate is a fact about right now that must be fetched; a table of them
 * baked into the source would be quietly wrong within a day, and a wrong number in a confident box is the failure this
 * whole file is arranged against. Currency belongs to a provider that can say when it last knew.
 */
export function convert(input: string): Converted | null {
  const raw = tidy(input).toLowerCase().replace(/^convert\s+/i, '')
  // Two ways of asking the same thing: "2 m to cm", and "how many cm in 2 m", which names the answer's unit first.
  const asked = /^how many\s+([a-z°/]+)\s+(?:in|are in|is)\s+([-\d.]+)\s*([a-z°/]+)\??$/i.exec(raw)
  const match = asked ? [raw, asked[2], asked[3], asked[1]] : /^([-\d.]+)\s*([a-z°/]+)\s+(?:to|in|into)\s+([a-z°/]+)\??$/i.exec(raw)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const fromKey = unitKey(match[2])
  const toKey = unitKey(match[3])
  if (fromKey === toKey) return null

  const fromTemp = TEMPERATURE[fromKey]
  const toTemp = TEMPERATURE[toKey]
  if (fromTemp && toTemp) {
    const value = toTemp.fromC(fromTemp.toC(amount))
    return {
      value,
      display: `${formatNumber(Number(value.toFixed(2)))} ${toTemp.name}`,
      from: { value: amount, unit: fromTemp.name },
      to: { unit: toTemp.name }
    }
  }

  const from = UNITS[fromKey]
  const to = UNITS[toKey]
  // Different families is not a conversion, it is a category error, and saying so beats producing a number.
  if (!from || !to || from.family !== to.family) return null
  const value = (amount * from.toBase) / to.toBase
  return {
    value,
    display: `${formatNumber(Number(value.toPrecision(10)))} ${to.name}`,
    from: { value: amount, unit: from.name },
    to: { unit: to.name }
  }
}
