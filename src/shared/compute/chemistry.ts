/**
 * Chemistry: the elements, formulas, and the arithmetic of how much reacts with how much.
 *
 * The shared chemistry engine for Orbis Pages. Formulas are parsed rather than looked up, equations are balanced by
 * solving the conservation equations, and an equation that cannot be balanced is refused by name — because an
 * unbalanceable equation is not a reaction, and a balanced-looking one with invented coefficients is worse than
 * nothing.
 *
 * ## Why the periodic table here is real data with a source
 *
 * Standard atomic weights are measured values with published uncertainties, and several of them changed within the
 * last twenty years as measurements improved. They are held as data with their source and their uncertainty, and the
 * elements whose atomic weight genuinely has no single value — because their isotopic composition varies by sample —
 * say so rather than quoting a number as though it were fixed.
 *
 * ## Why balancing is solved and not guessed
 *
 * Balancing an equation is a linear system: one conservation equation per element, one unknown per species. Solving
 * it finds the coefficients when they exist and proves they do not when they do not. Trial and error finds most
 * answers and cannot tell the difference between a hard equation and an impossible one.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * atomic number   vs  mass number      -- protons against protons plus neutrons
 * atomic weight   vs  isotope mass     -- an average over natural abundance against one nuclide
 * molecule        vs  formula unit     -- what H2O is against what NaCl is, which has no molecules
 * empirical       vs  molecular formula -- CH2O against C6H12O6
 * moles           vs  mass             -- a count against a weight, and the molar mass between them
 * limiting        vs  excess reagent   -- which one runs out first, which is the only one that matters
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { AVOGADRO_CONSTANT } from './emConstants.ts'

import { ALL_ELEMENTS } from './chemistry.table.ts'

export interface ChemistryError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'unknown-element'
    | 'bad-formula'
    | 'cannot-balance'
    | 'no-solution'
    | 'too-many'
    | 'no-data'
  message: string
}

export const isChemistryError = (value: unknown): value is ChemistryError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ChemistryError['error'], message: string): ChemistryError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const CHEMISTRY_LIMITS = Object.freeze({ formulaLength: 500, species: 64, atoms: 100_000, depth: 8 })

// ---------------------------------------------------------------- the elements

export interface Element {
  number: number
  symbol: string
  name: string
  /** g/mol. Null where the isotopic composition varies enough that no single value applies. */
  atomicWeight: number | null
  /** The uncertainty in the last digits, as published. Null where the weight itself is. */
  weightUncertainty: number | null
  /** The mass number of the most stable isotope, for elements with no stable one. */
  conventionalMass: number | null
  group: number | null
  period: number
  category: string
  /** Pauling scale. Null where it is not defined — the noble gases mostly. */
  electronegativity: number | null
  /** The electron configuration, abbreviated from the previous noble gas. */
  configuration: string
  /** How many electrons the outer shell has, for a main-group element. */
  valenceElectrons: number | null
  /** The oxidation states actually seen, most common first. */
  oxidationStates: readonly number[]
  note: string
}

export const ATOMIC_WEIGHT_SOURCE =
  'IUPAC Commission on Isotopic Abundances and Atomic Weights, 2021 standard atomic weights. Several changed this century as measurements improved, and a few have no single value because natural isotopic composition varies by sample.'

/**
 * The elements, with standard atomic weights from IUPAC.
 *
 * Held as data rather than derived, because atomic weights are measurements. Hydrogen, lithium, boron, carbon,
 * nitrogen, oxygen, silicon, sulphur, chlorine and thallium have isotopic compositions that vary enough between
 * sources that IUPAC publishes an interval rather than a value; the conventional single value is given here with a
 * note, because a Page doing stoichiometry needs a number and a Page reporting a precise mass needs to know it is
 * conventional.
 */
/**
 * The elements.
 *
 * The whole table of 118 lives in `chemistry.table.ts` -- a thousand lines of measurement does not belong in the
 * middle of an engine, and the engine imports it rather than restating it. This stays the name everything else uses.
 */
export const ELEMENTS: readonly Element[] = ALL_ELEMENTS

const BY_SYMBOL = new Map(ELEMENTS.map((one) => [one.symbol, one]))
const BY_NUMBER = new Map(ELEMENTS.map((one) => [one.number, one]))
const BY_NAME = new Map(ELEMENTS.map((one) => [one.name.toLowerCase(), one]))

/**
 * Look up an element by symbol, name or atomic number.
 *
 * The symbol lookup is case sensitive, deliberately. "CO" is carbon monoxide and "Co" is cobalt, and a
 * case-insensitive lookup would silently confuse a gas with a metal.
 */
export function elementBy(key: string | number): Element | ChemistryError {
  if (typeof key === 'number') {
    const found = BY_NUMBER.get(Math.round(key))
    return (
      found ??
      fail(
        'unknown-element',
        `There is no element ${key} in this table. It holds ${ELEMENTS.length} elements: the first thirty plus a selection of common heavier ones.`
      )
    )
  }
  const trimmed = key.trim()
  const bySymbol = BY_SYMBOL.get(trimmed)
  if (bySymbol) return bySymbol
  const byName = BY_NAME.get(trimmed.toLowerCase())
  if (byName) return byName
  const wrongCase = ELEMENTS.find((one) => one.symbol.toLowerCase() === trimmed.toLowerCase())
  if (wrongCase) {
    return fail(
      'unknown-element',
      `"${trimmed}" is not a symbol, but "${wrongCase.symbol}" is. Symbols are case sensitive here on purpose: CO is carbon monoxide and Co is cobalt, and confusing a gas with a metal is not a small error.`
    )
  }
  return fail('unknown-element', `"${trimmed}" is not an element this table holds.`)
}

// ---------------------------------------------------------------- formulas

export interface FormulaReport {
  formula: string
  /** Each element and how many atoms of it. */
  composition: readonly { symbol: string; name: string; count: number; atomicWeight: number; massContribution: number; massPercent: number }[]
  /** g/mol. */
  molarMass: number
  /** The uncertainty in the molar mass, from the atomic weights. */
  molarMassUncertainty: number
  /** How many atoms in one formula unit. */
  totalAtoms: number
  /** The formula reduced to its smallest whole-number ratio. */
  empiricalFormula: string
  /** Whether the formula given was already empirical. */
  isEmpirical: boolean
  /** The charge, when the formula carried one. */
  charge: number
  notes: readonly string[]
  warnings: readonly string[]
}

interface Token {
  kind: 'element' | 'open' | 'close' | 'count' | 'charge' | 'dot'
  value: string
  count?: number
}

/**
 * Parse a chemical formula into its composition and molar mass.
 *
 * Handles nested brackets, hydrates written with a dot, and a trailing charge. The parsing is real: it tokenises
 * and walks the structure rather than pattern-matching common cases, so Ca3(PO4)2 and CuSO4.5H2O both come out
 * right and a malformed formula is refused with the position of the problem rather than being partly understood.
 */
export function parseFormula(formula: string): FormulaReport | ChemistryError {
  if (typeof formula !== 'string') return fail('invalid-argument', 'A formula has to be text.')
  const text = formula.trim()
  if (text.length === 0) return fail('bad-formula', 'There is no formula to parse.')
  if (text.length > CHEMISTRY_LIMITS.formulaLength) {
    return fail('too-many', `That formula is ${text.length} characters; this parses up to ${CHEMISTRY_LIMITS.formulaLength}.`)
  }

  // Tokenise. A symbol is an uppercase letter and any lowercase letters after it.
  const tokens: Token[] = []
  let i = 0
  let charge = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ') {
      i += 1
      continue
    }
    if (c === '(' || c === '[') {
      tokens.push({ kind: 'open', value: c })
      i += 1
      continue
    }
    if (c === ')' || c === ']') {
      tokens.push({ kind: 'close', value: c })
      i += 1
      continue
    }
    if (c === '.' || c === '·' || c === '*') {
      tokens.push({ kind: 'dot', value: '.' })
      i += 1
      continue
    }
    if (/[A-Z]/.test(c)) {
      let symbol = c
      i += 1
      while (i < text.length && /[a-z]/.test(text[i])) {
        symbol += text[i]
        i += 1
      }
      const element = elementBy(symbol)
      if (isChemistryError(element)) {
        return fail(
          'bad-formula',
          `"${symbol}" at position ${i - symbol.length + 1} is not an element this table holds. ${element.message}`
        )
      }
      tokens.push({ kind: 'element', value: symbol })
      continue
    }
    if (/[0-9]/.test(c)) {
      let digits = ''
      while (i < text.length && /[0-9]/.test(text[i])) {
        digits += text[i]
        i += 1
      }
      // Digits immediately before a + or - are the magnitude of a charge, not a subscript. That is how Fe3+ and
      // SO4 2- are universally written, and reading the 3 in Fe3+ as three iron atoms would be a silent disaster.
      if (i < text.length && (text[i] === '+' || text[i] === '-')) {
        charge += (text[i] === '+' ? 1 : -1) * Number(digits)
        i += 1
        tokens.push({ kind: 'charge', value: text[i - 1] })
        continue
      }
      tokens.push({ kind: 'count', value: digits, count: Number(digits) })
      continue
    }
    if (c === '+' || c === '-') {
      // A trailing charge, possibly with a magnitude.
      let magnitude = 1
      i += 1
      let digits = ''
      while (i < text.length && /[0-9]/.test(text[i])) {
        digits += text[i]
        i += 1
      }
      if (digits.length > 0) magnitude = Number(digits)
      // Repeated signs, as in SO4 2- written Fe3+ or Ca++.
      while (i < text.length && text[i] === c) {
        magnitude += 1
        i += 1
      }
      charge += c === '+' ? magnitude : -magnitude
      tokens.push({ kind: 'charge', value: c })
      continue
    }
    return fail('bad-formula', `"${c}" at position ${i + 1} is not something a formula can contain.`)
  }

  // Walk the tokens, keeping a stack for brackets.
  const counts = new Map<string, number>()
  const stack: Map<string, number>[] = [counts]
  let hydrateMultiplier = 1
  let pendingHydrate = false

  const addTo = (target: Map<string, number>, symbol: string, amount: number): void => {
    target.set(symbol, (target.get(symbol) ?? 0) + amount)
  }

  for (let t = 0; t < tokens.length; t += 1) {
    const token = tokens[t]
    const top = stack[stack.length - 1]
    if (token.kind === 'element') {
      const next = tokens[t + 1]
      const amount = next !== undefined && next.kind === 'count' ? (next.count as number) : 1
      if (amount === 0) return fail('bad-formula', `"${token.value}0" means no atoms of it, which is not something a formula says. Leave it out instead.`)
      addTo(top, token.value, amount * (pendingHydrate ? hydrateMultiplier : 1))
      if (next !== undefined && next.kind === 'count') t += 1
      continue
    }
    if (token.kind === 'open') {
      if (stack.length > CHEMISTRY_LIMITS.depth) return fail('too-many', `Brackets are nested more than ${CHEMISTRY_LIMITS.depth} deep.`)
      stack.push(new Map())
      continue
    }
    if (token.kind === 'close') {
      if (stack.length === 1) return fail('bad-formula', `There is a closing bracket at position ${t + 1} with nothing open.`)
      const group = stack.pop() as Map<string, number>
      const next = tokens[t + 1]
      const multiplier = next !== undefined && next.kind === 'count' ? (next.count as number) : 1
      if (multiplier === 0) return fail('bad-formula', 'A bracketed group multiplied by zero contributes nothing, which is not something a formula says.')
      const parent = stack[stack.length - 1]
      for (const [symbol, amount] of group) addTo(parent, symbol, amount * multiplier)
      if (next !== undefined && next.kind === 'count') t += 1
      continue
    }
    if (token.kind === 'dot') {
      if (stack.length > 1) return fail('bad-formula', 'A hydrate dot inside brackets is not something this parses.')
      const next = tokens[t + 1]
      hydrateMultiplier = next !== undefined && next.kind === 'count' ? (next.count as number) : 1
      pendingHydrate = true
      if (next !== undefined && next.kind === 'count') t += 1
      continue
    }
    // A charge token; already accounted for.
  }

  if (stack.length > 1) return fail('bad-formula', 'There is an unclosed bracket in this formula.')
  if (counts.size === 0) return fail('bad-formula', 'No elements were found in this formula.')

  let molarMass = 0
  let variance = 0
  let totalAtoms = 0
  const warnings: string[] = []
  const composition: { symbol: string; name: string; count: number; atomicWeight: number; massContribution: number; massPercent: number }[] = []

  for (const [symbol, count] of counts) {
    const element = elementBy(symbol)
    if (isChemistryError(element)) return element
    if (element.atomicWeight === null) {
      return fail(
        'no-data',
        `${element.name} has no single standard atomic weight, so a molar mass cannot be given. ${element.note}`
      )
    }
    if (count > CHEMISTRY_LIMITS.atoms) return fail('too-many', `That is ${count} atoms of ${symbol}; this handles up to ${CHEMISTRY_LIMITS.atoms}.`)
    const contribution = element.atomicWeight * count
    molarMass += contribution
    if (element.weightUncertainty !== null) variance += Math.pow(element.weightUncertainty * count, 2)
    totalAtoms += count
    composition.push({
      symbol,
      name: element.name,
      count,
      atomicWeight: element.atomicWeight,
      massContribution: contribution,
      massPercent: 0
    })
    if (element.note.includes('varies') || element.note.includes('interval')) {
      warnings.push(`${element.name}: ${element.note}`)
    }
  }

  for (const one of composition) one.massPercent = (one.massContribution / molarMass) * 100
  composition.sort((a, b) => b.massContribution - a.massContribution)

  // The empirical formula: divide every count by their greatest common divisor.
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = [...counts.values()].reduce((current, one) => gcd(current, one))
  const empirical = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([symbol, count]) => `${symbol}${count / divisor === 1 ? '' : count / divisor}`)
    .join('')

  return {
    formula: text,
    composition: Object.freeze(composition),
    molarMass,
    molarMassUncertainty: Math.sqrt(variance),
    totalAtoms,
    empiricalFormula: empirical,
    isEmpirical: divisor === 1,
    charge,
    notes: Object.freeze([
      `${text} has a molar mass of ${molarMass.toFixed(4)} +/- ${Math.sqrt(variance).toFixed(4)} g/mol over ${totalAtoms} atoms.`,
      `Heaviest contributor: ${composition[0].name} at ${composition[0].massPercent.toFixed(2)}% of the mass.`,
      divisor === 1
        ? 'This is already an empirical formula — the counts share no common factor.'
        : `The empirical formula is ${empirical}: the same ratio with the common factor of ${divisor} removed. An empirical formula cannot tell you the molecule’s size, which is why glucose and formaldehyde share one.`,
      charge === 0 ? '' : `The species carries a charge of ${charge > 0 ? '+' : ''}${charge}.`,
      ATOMIC_WEIGHT_SOURCE
    ].filter((one) => one.length > 0)),
    warnings: Object.freeze([...new Set(warnings)])
  }
}

// ---------------------------------------------------------------- balancing

export interface BalanceReport {
  /** The balanced equation as text. */
  equation: string
  reactants: readonly { formula: string; coefficient: number; molarMass: number }[]
  products: readonly { formula: string; coefficient: number; molarMass: number }[]
  /** Each element, with how many atoms on each side. */
  elementCheck: readonly { symbol: string; reactantAtoms: number; productAtoms: number; balanced: boolean }[]
  /** Whether mass is conserved, which follows from the atoms balancing. */
  massBalanced: boolean
  reactantMass: number
  productMass: number
  /** Whether the charges balance too, which matters for an ionic equation. */
  chargeBalanced: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/** Solve an integer linear system by Gaussian elimination over rationals, then scale to whole numbers. */
function balanceCoefficients(matrix: readonly (readonly number[])[], speciesCount: number): number[] | null {
  const rows = matrix.length
  const a = matrix.map((row) => [...row])

  // Row reduce.
  let pivotRow = 0
  const pivotColumns: number[] = []
  for (let column = 0; column < speciesCount && pivotRow < rows; column += 1) {
    let best = -1
    let bestValue = 0
    for (let r = pivotRow; r < rows; r += 1) {
      if (Math.abs(a[r][column]) > bestValue) {
        bestValue = Math.abs(a[r][column])
        best = r
      }
    }
    if (best === -1 || bestValue < 1e-12) continue
    ;[a[pivotRow], a[best]] = [a[best], a[pivotRow]]
    const pivot = a[pivotRow][column]
    for (let k = column; k < speciesCount; k += 1) a[pivotRow][k] /= pivot
    for (let r = 0; r < rows; r += 1) {
      if (r === pivotRow) continue
      const factor = a[r][column]
      if (Math.abs(factor) < 1e-15) continue
      for (let k = column; k < speciesCount; k += 1) a[r][k] -= factor * a[pivotRow][k]
    }
    pivotColumns.push(column)
    pivotRow += 1
  }

  // The free columns are the ones with no pivot. A balanceable equation has exactly one.
  const free: number[] = []
  for (let column = 0; column < speciesCount; column += 1) {
    if (!pivotColumns.includes(column)) free.push(column)
  }
  if (free.length !== 1) return null

  const solution = new Array<number>(speciesCount).fill(0)
  solution[free[0]] = 1
  for (let r = pivotColumns.length - 1; r >= 0; r -= 1) {
    const column = pivotColumns[r]
    let sum = 0
    for (let k = column + 1; k < speciesCount; k += 1) sum += a[r][k] * solution[k]
    solution[column] = -sum
  }

  // Scale to the smallest whole numbers. Rationalise by multiplying up to a common denominator.
  let multiplier = 1
  for (let attempt = 1; attempt <= 5000; attempt += 1) {
    if (solution.every((one) => Math.abs(one * attempt - Math.round(one * attempt)) < 1e-6)) {
      multiplier = attempt
      break
    }
  }
  const whole = solution.map((one) => Math.round(one * multiplier))
  if (whole.some((one) => one === 0)) return null
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y))
  const divisor = whole.map(Math.abs).reduce((current, one) => gcd(current, one))
  const scaled = whole.map((one) => one / divisor)
  // Every coefficient has to come out positive; a negative one means a species is on the wrong side.
  if (scaled.some((one) => one <= 0)) return null
  return scaled
}

/**
 * Balance a chemical equation by solving the conservation equations.
 *
 * One equation per element, one unknown per species, solved as a linear system. That finds the coefficients when
 * they exist and proves they do not when they do not — trial and error finds most answers and cannot distinguish a
 * hard equation from an impossible one.
 *
 * A negative coefficient means a species is on the wrong side of the arrow, and that is reported as unbalanceable
 * rather than returned as a negative amount of something.
 */
export function balanceEquation(input: {
  reactants: readonly string[]
  products: readonly string[]
}): BalanceReport | ChemistryError {
  const { reactants, products } = input
  if (reactants.length === 0 || products.length === 0) {
    return fail('invalid-argument', 'An equation needs at least one species on each side.')
  }
  if (reactants.length + products.length > CHEMISTRY_LIMITS.species) {
    return fail('too-many', `That is ${reactants.length + products.length} species; this balances up to ${CHEMISTRY_LIMITS.species}.`)
  }

  const parsed: { formula: string; composition: Map<string, number>; molarMass: number; charge: number; side: 1 | -1 }[] = []
  for (const [side, list] of [[1, reactants], [-1, products]] as const) {
    for (const formula of list) {
      const report = parseFormula(formula)
      if (isChemistryError(report)) return report
      const composition = new Map(report.composition.map((one) => [one.symbol, one.count]))
      parsed.push({ formula: report.formula, composition, molarMass: report.molarMass, charge: report.charge, side })
    }
  }

  const symbols = [...new Set(parsed.flatMap((one) => [...one.composition.keys()]))].sort()
  // One row per element: sum of (coefficient * count * side) must be zero.
  const matrix = symbols.map((symbol) => parsed.map((one) => one.side * (one.composition.get(symbol) ?? 0)))

  const coefficients = balanceCoefficients(matrix, parsed.length)
  if (coefficients === null) {
    const onlyLeft = symbols.filter((symbol) => !parsed.some((one) => one.side === -1 && one.composition.has(symbol)))
    const onlyRight = symbols.filter((symbol) => !parsed.some((one) => one.side === 1 && one.composition.has(symbol)))
    const missing = [...onlyLeft.map((one) => `${one} appears only on the left`), ...onlyRight.map((one) => `${one} appears only on the right`)]
    return fail(
      'cannot-balance',
      missing.length > 0
        ? `This equation cannot be balanced: ${missing.join(', ')}. An element has to appear on both sides, because atoms are not created or destroyed.`
        : 'This equation cannot be balanced with positive whole-number coefficients. Either a species is on the wrong side of the arrow, or the reaction as written does not conserve atoms.'
    )
  }

  const described = parsed.map((one, i) => ({ ...one, coefficient: coefficients[i] }))
  const reactantSide = described.filter((one) => one.side === 1)
  const productSide = described.filter((one) => one.side === -1)

  const elementCheck = symbols.map((symbol) => {
    const left = reactantSide.reduce((sum, one) => sum + one.coefficient * (one.composition.get(symbol) ?? 0), 0)
    const right = productSide.reduce((sum, one) => sum + one.coefficient * (one.composition.get(symbol) ?? 0), 0)
    return { symbol, reactantAtoms: left, productAtoms: right, balanced: left === right }
  })

  const reactantMass = reactantSide.reduce((sum, one) => sum + one.coefficient * one.molarMass, 0)
  const productMass = productSide.reduce((sum, one) => sum + one.coefficient * one.molarMass, 0)
  const leftCharge = reactantSide.reduce((sum, one) => sum + one.coefficient * one.charge, 0)
  const rightCharge = productSide.reduce((sum, one) => sum + one.coefficient * one.charge, 0)

  const side = (list: typeof described): string =>
    list.map((one) => `${one.coefficient === 1 ? '' : one.coefficient}${one.formula}`).join(' + ')

  const warnings: string[] = []
  if (leftCharge !== rightCharge) {
    warnings.push(
      `The charges do not balance: ${leftCharge} on the left and ${rightCharge} on the right. The atoms balance, so this is a valid mass balance and not a valid ionic equation — something is missing, usually electrons or a spectator ion.`
    )
  }
  if (!elementCheck.every((one) => one.balanced)) {
    warnings.push('The solved coefficients do not balance every element, which should not happen. Treat this result as suspect.')
  }

  return {
    equation: `${side(reactantSide)} -> ${side(productSide)}`,
    reactants: Object.freeze(reactantSide.map((one) => ({ formula: one.formula, coefficient: one.coefficient, molarMass: one.molarMass }))),
    products: Object.freeze(productSide.map((one) => ({ formula: one.formula, coefficient: one.coefficient, molarMass: one.molarMass }))),
    elementCheck: Object.freeze(elementCheck),
    massBalanced: Math.abs(reactantMass - productMass) < Math.max(reactantMass, 1) * 1e-9,
    reactantMass,
    productMass,
    chargeBalanced: leftCharge === rightCharge,
    notes: Object.freeze([
      `${side(reactantSide)} -> ${side(productSide)}`,
      'Balanced by solving one conservation equation per element as a linear system, which finds the coefficients when they exist and proves they do not when they do not.',
      `Mass on the left is ${reactantMass.toFixed(4)} g/mol and on the right ${productMass.toFixed(4)}. They match because the atoms do — conservation of mass is a consequence here, not a separate check.`,
      'Coefficients are the smallest positive whole numbers that work. Multiplying them all by the same factor is equally valid and conventionally not done.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- stoichiometry

export interface StoichiometryReport {
  equation: string
  /** Which reagent runs out first, and the only one that sets the yield. */
  limitingReagent: string
  /** Each reagent: what was supplied, what is needed, what is left. */
  reagents: readonly {
    formula: string
    coefficient: number
    molesSupplied: number
    massSupplied: number
    molesNeeded: number
    molesLeftOver: number
    massLeftOver: number
    isLimiting: boolean
    excessPercent: number
  }[]
  /** Each product: how much is made if the reaction goes to completion. */
  products: readonly { formula: string; coefficient: number; moles: number; mass: number }[]
  /** Moles of reaction that occur. */
  extent: number
  /** The actual yield against the theoretical, when an actual was given. */
  percentYield: number | null
  /** How much product one gram of the limiting reagent makes, which is the number a plant cares about. */
  atomEconomy: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How much product a set of reagents makes, and which one runs out first.
 *
 * The limiting reagent is the whole point. Adding more of anything else changes nothing at all, and the commonest
 * error in the subject is scaling from the wrong reagent — which gives an answer that is too large and looks
 * perfectly reasonable. Every reagent's leftover is reported so it is visible which ones were in excess and by how
 * much.
 *
 * Atom economy is reported because percent yield hides it: a reaction can run at 95% yield and still waste most of
 * its input mass as by-products, and those are different problems with different fixes.
 */
export function stoichiometry(input: {
  reactants: readonly string[]
  products: readonly string[]
  /** Grams supplied, or moles, keyed by formula. */
  suppliedGrams?: Readonly<Record<string, number>>
  suppliedMoles?: Readonly<Record<string, number>>
  /** Grams of the product actually obtained, for a percent yield. */
  actualYieldGrams?: number
  /** Which product the yield refers to. Defaults to the first. */
  yieldOf?: string
}): StoichiometryReport | ChemistryError {
  const balanced = balanceEquation({ reactants: input.reactants, products: input.products })
  if (isChemistryError(balanced)) return balanced

  const supplied = new Map<string, number>()
  for (const [formula, grams] of Object.entries(input.suppliedGrams ?? {})) {
    if (!finite(grams) || grams < 0) return fail('invalid-argument', `The mass supplied of ${formula} has to be zero or more.`)
    const match = balanced.reactants.find((one) => one.formula === formula)
    if (!match) {
      return fail(
        'invalid-argument',
        `"${formula}" was supplied and is not a reactant in this equation. Its reactants are: ${balanced.reactants.map((one) => one.formula).join(', ')}.`
      )
    }
    supplied.set(formula, grams / match.molarMass)
  }
  for (const [formula, moles] of Object.entries(input.suppliedMoles ?? {})) {
    if (!finite(moles) || moles < 0) return fail('invalid-argument', `The moles supplied of ${formula} has to be zero or more.`)
    if (supplied.has(formula)) {
      return fail('invalid-argument', `${formula} was given both as a mass and as moles. Either fixes the other, so pick one.`)
    }
    if (!balanced.reactants.some((one) => one.formula === formula)) {
      return fail(
        'invalid-argument',
        `"${formula}" was supplied and is not a reactant in this equation. Its reactants are: ${balanced.reactants.map((one) => one.formula).join(', ')}.`
      )
    }
    supplied.set(formula, moles)
  }

  if (supplied.size === 0) {
    return fail('invalid-argument', 'Nothing was supplied. Give a mass or a mole count for at least one reactant.')
  }
  const unsupplied = balanced.reactants.filter((one) => !supplied.has(one.formula))
  const warnings: string[] = []
  if (unsupplied.length > 0) {
    warnings.push(
      `No amount was given for ${unsupplied.map((one) => one.formula).join(', ')}, so ${unsupplied.length === 1 ? 'it was' : 'they were'} taken as being in excess. If ${unsupplied.length === 1 ? 'it is' : 'any of them is'} actually short, the yield below is too high.`
    )
  }

  // The extent of reaction is set by whichever supplied reagent gives the smallest ratio.
  let extent = Number.POSITIVE_INFINITY
  let limiting = ''
  for (const one of balanced.reactants) {
    const moles = supplied.get(one.formula)
    if (moles === undefined) continue
    const possible = moles / one.coefficient
    if (possible < extent) {
      extent = possible
      limiting = one.formula
    }
  }
  if (!finite(extent)) return fail('no-solution', 'No supplied reagent could be matched to the equation, so there is nothing to limit the reaction.')

  const reagents = balanced.reactants.map((one) => {
    const moles = supplied.get(one.formula)
    const needed = extent * one.coefficient
    const have = moles ?? needed
    return {
      formula: one.formula,
      coefficient: one.coefficient,
      molesSupplied: have,
      massSupplied: have * one.molarMass,
      molesNeeded: needed,
      molesLeftOver: have - needed,
      massLeftOver: (have - needed) * one.molarMass,
      isLimiting: one.formula === limiting,
      excessPercent: needed === 0 ? 0 : ((have - needed) / needed) * 100
    }
  })

  const productList = balanced.products.map((one) => ({
    formula: one.formula,
    coefficient: one.coefficient,
    moles: extent * one.coefficient,
    mass: extent * one.coefficient * one.molarMass
  }))

  const yieldTarget = input.yieldOf ?? productList[0]?.formula
  const targetProduct = productList.find((one) => one.formula === yieldTarget)
  let percentYield: number | null = null
  if (input.actualYieldGrams !== undefined) {
    if (!finite(input.actualYieldGrams) || input.actualYieldGrams < 0) {
      return fail('invalid-argument', 'The actual yield has to be zero or more grams.')
    }
    if (targetProduct === undefined) {
      return fail('invalid-argument', `"${yieldTarget}" is not one of the products: ${productList.map((one) => one.formula).join(', ')}.`)
    }
    percentYield = targetProduct.mass === 0 ? 0 : (input.actualYieldGrams / targetProduct.mass) * 100
    if (percentYield > 100.0001) {
      warnings.push(
        `The actual yield is ${percentYield.toFixed(2)}% of theoretical, which is above 100% and therefore impossible. The usual causes are a wet or impure product, or the wrong limiting reagent — not an unusually good reaction.`
      )
    }
  }

  // Atom economy: the mass of the wanted product over the total mass of reactants consumed.
  const consumedMass = reagents.reduce((sum, one) => sum + one.molesNeeded * (balanced.reactants.find((r) => r.formula === one.formula)?.molarMass ?? 0), 0)
  const atomEconomy = consumedMass === 0 ? 0 : ((targetProduct?.mass ?? 0) / consumedMass) * 100

  if (atomEconomy < 50 && productList.length > 1) {
    warnings.push(
      `The atom economy is ${atomEconomy.toFixed(1)}%: over half the reactant mass ends up in something other than the wanted product. A high percent yield does not fix that, and they are different problems with different solutions.`
    )
  }

  return {
    equation: balanced.equation,
    limitingReagent: limiting,
    reagents: Object.freeze(reagents),
    products: Object.freeze(productList),
    extent,
    percentYield,
    atomEconomy,
    notes: Object.freeze([
      `${balanced.equation}, limited by ${limiting}.`,
      `${extent.toExponential(5)} moles of reaction occur, making ${productList.map((one) => `${one.mass.toFixed(4)} g of ${one.formula}`).join(' and ')}.`,
      'Only the limiting reagent sets the yield. Adding more of anything else changes nothing, and scaling from the wrong reagent is the commonest error in the subject — it gives an answer that is too large and looks perfectly reasonable.',
      `Atom economy ${atomEconomy.toFixed(1)}%: the fraction of consumed reactant mass that ends up in the wanted product. Percent yield says how well the reaction ran; atom economy says whether the reaction was worth running.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface MoleReport {
  /** Moles. */
  moles: number
  /** Grams. */
  mass: number
  /** How many particles. */
  particles: number
  /** Litres, for a gas at the conditions given. */
  gasVolume: number | null
  molarMass: number
  formula: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Convert between mass, moles, particle count and gas volume.
 *
 * The particle count is included because it is the thing a mole actually is, and the number is worth seeing: a gram
 * of water holds 3.3 × 10²² molecules, which is why chemistry can treat matter as continuous and get away with it.
 */
export function moleConversion(input: {
  formula: string
  /** One of these. */
  grams?: number
  moles?: number
  particles?: number
  litresOfGas?: number
  /** Kelvin and pascals, for a gas volume. Defaults to standard temperature and pressure. */
  temperature?: number
  pressure?: number
}): MoleReport | ChemistryError {
  const parsed = parseFormula(input.formula)
  if (isChemistryError(parsed)) return parsed

  const given = (['grams', 'moles', 'particles', 'litresOfGas'] as const).filter((one) => input[one] !== undefined)
  if (given.length === 0) return fail('invalid-argument', 'Give a mass in grams, a number of moles, a particle count, or a gas volume in litres.')
  if (given.length > 1) return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one fixes the others, so pick one.`)

  const temperature = input.temperature ?? 273.15
  const pressure = input.pressure ?? 101325
  if (!finite(temperature) || temperature <= 0) return fail('invalid-argument', 'The temperature is in kelvin and has to be above zero.')
  if (!finite(pressure) || pressure <= 0) return fail('invalid-argument', 'The pressure has to be greater than zero.')
  // The molar volume in litres at these conditions, from the ideal gas law.
  const molarVolume = (8.31446261815324 * temperature) / pressure * 1000

  let moles: number
  if (input.moles !== undefined) moles = input.moles
  else if (input.grams !== undefined) moles = input.grams / parsed.molarMass
  else if (input.particles !== undefined) moles = input.particles / AVOGADRO_CONSTANT
  else moles = (input.litresOfGas as number) / molarVolume

  if (!finite(moles) || moles < 0) return fail('invalid-argument', 'That works out to a negative or non-finite number of moles.')

  const warnings: string[] = [...parsed.warnings]
  if (input.litresOfGas !== undefined && input.temperature === undefined) {
    warnings.push(
      'A gas volume was given with no temperature or pressure, so standard temperature and pressure were assumed — 273.15 K and 101325 Pa, giving 22.4 L/mol. Room temperature gives 24.5 L/mol, which is a 9% difference.'
    )
  }

  return {
    moles,
    mass: moles * parsed.molarMass,
    particles: moles * AVOGADRO_CONSTANT,
    gasVolume: moles * molarVolume,
    molarMass: parsed.molarMass,
    formula: parsed.formula,
    notes: Object.freeze([
      `${moles.toExponential(5)} mol of ${parsed.formula} is ${(moles * parsed.molarMass).toFixed(5)} g and ${(moles * AVOGADRO_CONSTANT).toExponential(4)} particles.`,
      `A mole is a count, not a mass: ${AVOGADRO_CONSTANT.toExponential(6)} of anything. The molar mass is what converts between the count and the weight.`,
      `As a gas at ${temperature} K and ${(pressure / 1000).toFixed(2)} kPa that is ${(moles * molarVolume).toFixed(4)} L, since the molar volume there is ${molarVolume.toFixed(3)} L/mol.`,
      'The gas volume assumes ideal behaviour and assumes the substance is a gas at those conditions, which for most formulas it is not.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CHEMISTRY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Atomic weights are IUPAC standard values with their published uncertainties, and the molar mass uncertainty is propagated.',
  'Elements whose natural isotopic composition varies say so, because their atomic weight is a convention rather than a measurement of your sample.',
  'Element symbols are case sensitive. CO is carbon monoxide and Co is cobalt, and a case-insensitive lookup would confuse a gas with a metal.',
  'Formulas are tokenised and walked, so nested brackets and hydrates parse properly and a malformed formula is refused with the position of the problem.',
  'Digits immediately before a plus or minus are a charge magnitude, not a subscript. Fe3+ is one iron ion with a charge of three, which is how it is universally written.',
  'Equations are balanced by solving the conservation equations, which proves when no balance exists rather than failing to find one.',
  'A negative coefficient is reported as unbalanceable, because it means a species is on the wrong side of the arrow.',
  'Charge balance is checked separately from mass balance. An equation can conserve atoms and not charge, and then something is missing.',
  'Stoichiometry reports the limiting reagent and every leftover, because scaling from the wrong reagent is the commonest error in the subject.',
  'Atom economy is reported beside percent yield. A reaction can run at 95% yield and waste most of its input mass.',
  'Gas volumes assume ideal behaviour and assume the substance is a gas at the conditions given.'
])
