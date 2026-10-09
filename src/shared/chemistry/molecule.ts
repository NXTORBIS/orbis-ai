/**
 * Building a molecule from its name or formula, and checking what came back.
 *
 * ## Why the checking is the point
 *
 * A model asked for the structure of caffeine will answer. It will answer for a compound that does not exist
 * too, and it will sometimes answer for caffeine with the wrong number of hydrogens, or with two atoms at the
 * same coordinates, or with a bond to atom 14 of a 12-atom molecule. None of those look wrong on screen — they
 * look like a molecule.
 *
 * So nothing a model says is drawn until it has been checked against something that does not come from the
 * model: the formula, parsed here; the number of bonds each element can have; and whether the geometry is a
 * geometry at all. What fails is reported with the reason, never quietly repaired — a repaired structure is a
 * made-up structure wearing the model's authority.
 *
 * ## The order it tries
 *
 * 1. Orbis's own table, for the common molecules. No model, exact geometry, instant.
 * 2. The formula alone, parsed locally — enough to say what it is made of even with no structure.
 * 3. A model, checked as above.
 *
 * Which of the three answered is reported, because "from a table" and "worked out by a model and checked" are
 * different kinds of claim and the screen should not pretend otherwise.
 */

import { build } from './geometry.ts'
import { isSmilesProblem, readSmiles } from './smiles.ts'

export interface MoleculeProblem {
  problem: string
  fix: string
}

export const isMoleculeProblem = (held: unknown): held is MoleculeProblem =>
  typeof held === 'object' && held !== null && 'problem' in held

const no = (problem: string, fix: string): MoleculeProblem => ({ problem, fix })

// ---------------------------------------------------------------- the elements, enough of them

/**
 * How many bonds each element usually makes, and its covalent radius in picometres.
 *
 * Only what the checking needs. The full element data lives in the ported studio's own `elementsData.js`; this
 * is here because the check has to run without a screen, and because a wrong valence is the single most common
 * thing a model gets wrong about a structure it has invented.
 *
 * `bonds` is the usual number, and `most` is the highest that is still ordinary — sulfur makes 2 in H₂S and 6 in
 * SF₆, and both are real, so a range is the honest thing to check against.
 */
interface ElementFacts {
  mass: number
  bonds: number
  most: number
  radius: number
}

const ELEMENTS: Readonly<Record<string, ElementFacts>> = Object.freeze({
  H: { mass: 1.008, bonds: 1, most: 1, radius: 31 },
  He: { mass: 4.003, bonds: 0, most: 0, radius: 28 },
  Li: { mass: 6.94, bonds: 1, most: 1, radius: 128 },
  Be: { mass: 9.012, bonds: 2, most: 2, radius: 96 },
  B: { mass: 10.81, bonds: 3, most: 4, radius: 84 },
  C: { mass: 12.011, bonds: 4, most: 4, radius: 76 },
  N: { mass: 14.007, bonds: 3, most: 4, radius: 71 },
  O: { mass: 15.999, bonds: 2, most: 3, radius: 66 },
  F: { mass: 18.998, bonds: 1, most: 1, radius: 57 },
  Ne: { mass: 20.18, bonds: 0, most: 0, radius: 58 },
  Na: { mass: 22.99, bonds: 1, most: 1, radius: 166 },
  Mg: { mass: 24.305, bonds: 2, most: 2, radius: 141 },
  Al: { mass: 26.982, bonds: 3, most: 6, radius: 121 },
  Si: { mass: 28.085, bonds: 4, most: 6, radius: 111 },
  P: { mass: 30.974, bonds: 3, most: 5, radius: 107 },
  S: { mass: 32.06, bonds: 2, most: 6, radius: 105 },
  Cl: { mass: 35.45, bonds: 1, most: 7, radius: 102 },
  Ar: { mass: 39.948, bonds: 0, most: 0, radius: 106 },
  K: { mass: 39.098, bonds: 1, most: 1, radius: 203 },
  Ca: { mass: 40.078, bonds: 2, most: 2, radius: 176 },
  Ti: { mass: 47.867, bonds: 4, most: 6, radius: 160 },
  Cr: { mass: 51.996, bonds: 3, most: 6, radius: 139 },
  Mn: { mass: 54.938, bonds: 2, most: 7, radius: 139 },
  Fe: { mass: 55.845, bonds: 3, most: 6, radius: 132 },
  Co: { mass: 58.933, bonds: 2, most: 6, radius: 126 },
  Ni: { mass: 58.693, bonds: 2, most: 6, radius: 124 },
  Cu: { mass: 63.546, bonds: 2, most: 4, radius: 132 },
  Zn: { mass: 65.38, bonds: 2, most: 4, radius: 122 },
  Br: { mass: 79.904, bonds: 1, most: 7, radius: 120 },
  Ag: { mass: 107.868, bonds: 1, most: 4, radius: 145 },
  I: { mass: 126.904, bonds: 1, most: 7, radius: 139 },
  Ba: { mass: 137.327, bonds: 2, most: 2, radius: 215 },
  Pt: { mass: 195.084, bonds: 4, most: 6, radius: 136 },
  Au: { mass: 196.967, bonds: 1, most: 3, radius: 136 },
  Hg: { mass: 200.592, bonds: 2, most: 2, radius: 132 },
  Pb: { mass: 207.2, bonds: 2, most: 4, radius: 146 },
  U: { mass: 238.029, bonds: 4, most: 6, radius: 196 }
})

export const knownElement = (symbol: string): boolean => Object.prototype.hasOwnProperty.call(ELEMENTS, symbol)

/** The colour each element is drawn in, so the same element looks the same everywhere. */
const COLOURS: Readonly<Record<string, string>> = Object.freeze({
  H: '#f1f5f9', C: '#94a3b8', N: '#60a5fa', O: '#f87171', S: '#fbbf24', P: '#fb923c',
  F: '#4ade80', Cl: '#4ade80', Br: '#c084fc', I: '#a78bfa',
  Na: '#f97316', K: '#f97316', Li: '#f97316',
  Mg: '#eab308', Ca: '#eab308', Ba: '#eab308',
  Fe: '#f87171', Cu: '#fb923c', Zn: '#818cf8', Ag: '#cbd5e1', Au: '#fbbf24'
})

export const colourFor = (symbol: string): string => COLOURS[symbol] ?? '#cbd5e1'

// ---------------------------------------------------------------- the formula, parsed here

export interface Counted {
  /** How many of each element, by symbol. */
  atoms: Readonly<Record<string, number>>
  /** How many atoms altogether. */
  total: number
  /** The molar mass in g/mol, from the counts. */
  mass: number
  /** The formula written back out in Hill order, so two spellings of the same thing compare equal. */
  tidy: string
}

/**
 * Counts the atoms in a formula.
 *
 * Handles brackets and their multipliers — Ca(OH)₂, Al₂(SO₄)₃ — and hydrates written with a dot, CuSO₄·5H₂O.
 * Subscript digits are accepted as well as ordinary ones, because that is what people paste.
 *
 * Refuses rather than guesses. "Hello" is not a formula, and neither is "Xx2": an unknown element symbol is
 * reported as unknown instead of silently counted, because a molar mass computed from a symbol nobody knows is
 * a number with no meaning.
 */
export function countFormula(text: string): Counted | MoleculeProblem {
  const SUBS: Record<string, string> = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9'
  }
  let formula = String(text ?? '').trim()
  if (formula === '') return no('Nothing was typed.', 'Type a formula, like H2O or C8H10N4O2.')
  formula = formula.replace(/[₀-₉]/g, (ch) => SUBS[ch] ?? ch).replace(/\s+/g, '')
  // Square and curly brackets mean the same thing as round ones here.
  formula = formula.replace(/[[{]/g, '(').replace(/[\]}]/g, ')')

  if (!/^[A-Za-z0-9()·.*·]+$/.test(formula)) {
    return no(`"${text}" has characters a formula does not.`, 'Use element symbols, numbers and brackets only.')
  }

  const counts: Record<string, number> = {}
  const unknown = new Set<string>()

  // A hydrate: each part counted and multiplied by its leading number.
  const parts = formula.split(/[·.*]/).filter((one) => one !== '')
  for (const part of parts) {
    const lead = /^(\d+)(.*)$/.exec(part)
    const times = lead ? Number(lead[1]) : 1
    const body = lead ? lead[2] : part
    if (body === '') return no(`"${part}" is a number with no formula after it.`, 'Write it as 5H2O rather than 5.')
    const got = countOne(body, unknown)
    if (isMoleculeProblem(got)) return got
    for (const [symbol, n] of Object.entries(got)) counts[symbol] = (counts[symbol] ?? 0) + n * times
  }

  if (unknown.size > 0) {
    return no(
      `${[...unknown].map((one) => `"${one}"`).join(', ')} ${unknown.size === 1 ? 'is not an element symbol' : 'are not element symbols'}.`,
      'Element symbols are a capital letter, sometimes with a small letter after it — Na, not NA or na.'
    )
  }
  if (Object.keys(counts).length === 0) return no(`"${text}" has no atoms in it.`, 'Type a formula, like H2O.')

  let mass = 0
  let total = 0
  for (const [symbol, n] of Object.entries(counts)) {
    mass += ELEMENTS[symbol].mass * n
    total += n
  }

  return { atoms: Object.freeze(counts), total, mass, tidy: hill(counts) }
}

/** One bracket-free-or-bracketed body, counted. Recursive for nested brackets. */
function countOne(body: string, unknown: Set<string>): Record<string, number> | MoleculeProblem {
  const counts: Record<string, number> = {}
  let at = 0

  const add = (from: Record<string, number>, times: number): void => {
    for (const [symbol, n] of Object.entries(from)) counts[symbol] = (counts[symbol] ?? 0) + n * times
  }

  while (at < body.length) {
    const ch = body[at]
    if (ch === '(') {
      // Find its partner, counting depth so nesting works.
      let depth = 1
      let close = at + 1
      while (close < body.length && depth > 0) {
        if (body[close] === '(') depth += 1
        if (body[close] === ')') depth -= 1
        close += 1
      }
      if (depth !== 0) return no('A bracket was opened and never closed.', 'Check the brackets match.')
      const inside = body.slice(at + 1, close - 1)
      const digits = /^\d+/.exec(body.slice(close))
      const times = digits ? Number(digits[0]) : 1
      if (times === 0) return no('A bracket multiplied by zero means nothing is there.', 'Use 1 or more.')
      const got = countOne(inside, unknown)
      if (isMoleculeProblem(got)) return got
      add(got, times)
      at = close + (digits ? digits[0].length : 0)
      continue
    }
    if (ch === ')') return no('A bracket was closed that was never opened.', 'Check the brackets match.')

    const symbol = /^[A-Z][a-z]?/.exec(body.slice(at))
    if (!symbol) {
      return no(
        `"${body.slice(at, at + 4)}" is not where an element symbol can start.`,
        'A symbol begins with a capital letter.'
      )
    }
    let name = symbol[0]
    // Two-letter symbols only count when they are real: "Co" is cobalt, but in "CoH" somebody may mean C and O.
    if (name.length === 2 && !knownElement(name) && knownElement(name[0])) name = name[0]
    if (!knownElement(name)) unknown.add(name)

    const digits = /^\d+/.exec(body.slice(at + name.length))
    const times = digits ? Number(digits[0]) : 1
    if (times === 0) return no(`"${name}0" means none of it.`, 'Leave the element out instead.')
    if (knownElement(name)) counts[name] = (counts[name] ?? 0) + times
    at += name.length + (digits ? digits[0].length : 0)
  }
  return counts
}

/** Hill order: carbon, then hydrogen, then everything else alphabetically. How chemists write a formula. */
function hill(counts: Readonly<Record<string, number>>): string {
  const rest = Object.keys(counts).filter((one) => one !== 'C' && one !== 'H').sort()
  const order = [...(counts.C ? ['C'] : []), ...(counts.H ? ['H'] : []), ...rest]
  return order.map((one) => `${one}${counts[one] > 1 ? counts[one] : ''}`).join('')
}

// ---------------------------------------------------------------- a structure

export interface Atom {
  symbol: string
  /** Position in picometres. */
  x: number
  y: number
  z: number
}

export interface Bond {
  /** Indices into `atoms`. */
  a: number
  b: number
  /** 1 single, 2 double, 3 triple. */
  order: 1 | 2 | 3
}

export interface Structure {
  name: string
  formula: string
  atoms: readonly Atom[]
  bonds: readonly Bond[]
  /** How this was arrived at. */
  from: 'table' | 'model'
  /** Whether the positions came with the answer or were worked out here from the bonds. */
  geometry: 'given' | 'computed'
  /** The SMILES string it was built from, when it was built from one. */
  smiles?: string
  /** What the checking noticed but allowed — things worth saying rather than refusing over. */
  notes: readonly string[]
  /** Plain facts about the molecule. Not problems, so these never colour the badge. */
  facts: readonly string[]
}

export interface Checked {
  structure: Structure
  counted: Counted
  /** The widest distance across the molecule, in picometres. */
  across: number
  /** Bonds per atom, for the panel to show. */
  degrees: readonly number[]
  /** The worst bond still out of its proper length, in picometres, when the geometry was computed. */
  worstBond: number
}

/**
 * Checks a proposed structure against the formula and against chemistry, and refuses what does not hold up.
 *
 * Every refusal here is something that happened: a model returning the right atoms with a bond to an index that
 * does not exist, two atoms at identical coordinates, a hydrogen with three bonds, a formula that does not match
 * the atoms it listed. Each would draw as a plausible molecule.
 *
 * Nothing is repaired. A structure that is wrong is reported as wrong, because a quietly corrected one carries
 * the model's authority without its content.
 */
export function checkStructure(
  proposed: { name?: unknown; formula?: unknown; atoms?: unknown; bonds?: unknown },
  wanted: string,
  from: Structure['from'] = 'model'
): Checked | MoleculeProblem {
  const counted = countFormula(wanted)
  if (isMoleculeProblem(counted)) return counted

  if (!Array.isArray(proposed?.atoms) || proposed.atoms.length === 0) {
    return no('No atoms came back.', 'Nothing can be drawn without them.')
  }
  if (proposed.atoms.length > 400) {
    return no(`${proposed.atoms.length} atoms is more than this will draw.`, 'Try a smaller molecule.')
  }

  const notes: string[] = []
  const atoms: Atom[] = []
  const seen: Record<string, number> = {}
  /** How many atoms came with a position, so a half-positioned answer is not half-believed. */
  let given = 0

  for (const [i, raw] of proposed.atoms.entries()) {
    if (typeof raw !== 'object' || raw === null) return no(`Atom ${i + 1} is not an atom.`, 'Each needs a symbol and a position.')
    const one = raw as Record<string, unknown>
    const symbol = String(one.symbol ?? one.element ?? one.s ?? '').trim()
    if (symbol === '') return no(`Atom ${i + 1} has no element symbol.`, 'Each atom needs one.')
    if (!knownElement(symbol)) {
      return no(`Atom ${i + 1} is "${symbol}", which is not an element this knows.`, 'Check the symbol.')
    }
    /*
     * Positions are optional, because the model is no longer asked for them.
     *
     * A position that is there is checked as strictly as before -- a model that volunteers coordinates has done
     * no harm as long as they are a geometry. One that gives none gets its geometry built from the bonds, which
     * is both more reliable and the only thing that works for a molecule like caffeine.
     */
    const gaveSome = one.x !== undefined || one.y !== undefined || one.z !== undefined
    const x = gaveSome ? Number(one.x ?? 0) : 0
    const y = gaveSome ? Number(one.y ?? 0) : 0
    const z = gaveSome ? Number(one.z ?? 0) : 0
    if (gaveSome) {
      if (![x, y, z].every(Number.isFinite)) {
        return no(`Atom ${i + 1} (${symbol}) has a position that is not a number.`, 'Leave the positions out and they will be worked out from the bonds.')
      }
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 5000) {
        return no(`Atom ${i + 1} (${symbol}) is ${Math.round(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)))} pm from the centre.`, 'Leave the positions out and they will be worked out from the bonds.')
      }
      given += 1
    }
    atoms.push({ symbol, x, y, z })
    seen[symbol] = (seen[symbol] ?? 0) + 1
  }

  /*
   * The atoms must be the formula's atoms.
   *
   * This is the check that catches the most common invention: the right molecule with a hydrogen too few. Done
   * against the formula parsed here, which does not come from the model.
   */
  const wrong: string[] = []
  for (const symbol of new Set([...Object.keys(counted.atoms), ...Object.keys(seen)])) {
    const should = counted.atoms[symbol] ?? 0
    const got = seen[symbol] ?? 0
    if (should !== got) wrong.push(`${symbol}: ${counted.tidy} needs ${should}, ${got} came back`)
  }
  if (wrong.length > 0) {
    return no(
      `The atoms do not match ${counted.tidy}. ${wrong.join('; ')}.`,
      'The structure was not drawn, because one with the wrong atoms is a different molecule.'
    )
  }

  /*
   * Either every atom has a position or none does. A half-positioned answer is not believed in part: the
   * positioned atoms would be drawn where they were put and the rest piled at the origin.
   */
  const positioned = given === atoms.length && atoms.length > 0
  if (given > 0 && !positioned) {
    notes.push(`Only ${given} of the ${atoms.length} atoms came with a position, so the geometry was worked out from the bonds instead.`)
  }

  // Two atoms in the same place is not a molecule, and it draws as one atom. Only checkable where positions came.
  if (positioned) {
    for (let i = 0; i < atoms.length; i += 1) {
      for (let j = i + 1; j < atoms.length; j += 1) {
        const gap = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z)
        if (gap < 40) {
          return no(
            `Atoms ${i + 1} (${atoms[i].symbol}) and ${j + 1} (${atoms[j].symbol}) are ${gap.toFixed(0)} pm apart.`,
            'No two atoms are that close. The geometry that came back is not a geometry.'
          )
        }
      }
    }
  }

  const bonds: Bond[] = []
  const degrees = new Array<number>(atoms.length).fill(0)
  const already = new Set<string>()

  /*
   * Which way the bonds are numbered, decided once from all of them.
   *
   * A model asked for zero-based indices sometimes gives one-based ones. Deciding that bond by bond let the two
   * readings disagree within one molecule -- a pair that happened to be valid either way was read as zero-based
   * while the rest were shifted, and the result was a hydrogen with two bonds and a refused structure.
   */
  const rawBonds = Array.isArray(proposed.bonds) ? proposed.bonds : []
  const indices: number[] = []
  for (const raw of rawBonds) {
    if (typeof raw !== 'object' || raw === null) continue
    const one = raw as Record<string, unknown>
    for (const key of ['a', 'from', 'i'] as const) if (one[key] !== undefined) { indices.push(Number(one[key])); break }
    for (const key of ['b', 'to', 'j'] as const) if (one[key] !== undefined) { indices.push(Number(one[key])); break }
  }
  const whole = indices.filter(Number.isInteger)
  const fromOne =
    whole.length > 0 &&
    whole.some((one) => one >= atoms.length) &&
    whole.every((one) => one >= 1 && one <= atoms.length)
  if (fromOne) notes.push('The bonds were numbered from 1 rather than 0; read that way.')

  if (rawBonds.length > 0) {
    for (const [i, raw] of rawBonds.entries()) {
      if (typeof raw !== 'object' || raw === null) return no(`Bond ${i + 1} is not a bond.`, 'Each needs two atom numbers.')
      const one = raw as Record<string, unknown>
      // Their own gallery uses a/b; a model often sends from/to, or 1-based numbers.
      let a = Number(one.a ?? one.from ?? one.i)
      let b = Number(one.b ?? one.to ?? one.j)
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        return no(`Bond ${i + 1} does not say which atoms it joins.`, 'Each bond needs two atom numbers.')
      }
      if (fromOne) {
        a -= 1
        b -= 1
      }
      if (a < 0 || b < 0 || a >= atoms.length || b >= atoms.length) {
        return no(
          `Bond ${i + 1} joins atoms ${a + 1} and ${b + 1}, but there are only ${atoms.length}.`,
          'A bond to an atom that is not there means the structure is not consistent.'
        )
      }
      if (a === b) return no(`Bond ${i + 1} joins an atom to itself.`, 'That is not a bond.')

      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (already.has(key)) {
        notes.push(`Atoms ${a + 1} and ${b + 1} were bonded twice; the repeat was dropped.`)
        continue
      }
      already.add(key)

      const order = Number(one.order ?? one.o ?? one.type ?? 1)
      const kept: 1 | 2 | 3 = order === 3 ? 3 : order === 2 ? 2 : 1
      if (![1, 2, 3].includes(order)) notes.push(`Bond ${i + 1} had an order of ${order}; read as ${kept}.`)

      const gap = positioned
        ? Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z)
        : 0
      const reach = (ELEMENTS[atoms[a].symbol].radius + ELEMENTS[atoms[b].symbol].radius) * 1.45
      if (positioned && gap > reach) {
        notes.push(
          `The bond between atoms ${a + 1} and ${b + 1} is ${gap.toFixed(0)} pm, which is long for ${atoms[a].symbol}–${atoms[b].symbol}.`
        )
      }

      bonds.push({ a, b, order: kept })
      degrees[a] += kept
      degrees[b] += kept
    }
  }

  /*
   * Too many bonds on an atom is reported but not refused.
   *
   * A hydrogen with two bonds is certainly wrong. A sulfur with six is sulfur hexafluoride. Refusing on count
   * alone would throw away correct structures, so the unusual ones are said and the impossible ones — more than
   * the element's highest ordinary valence — are refused.
   */
  for (let i = 0; i < atoms.length; i += 1) {
    const facts = ELEMENTS[atoms[i].symbol]
    if (degrees[i] > facts.most) {
      return no(
        `Atom ${i + 1} is ${atoms[i].symbol} with ${degrees[i]} bonds, and ${atoms[i].symbol} does not make more than ${facts.most}.`,
        'The structure was not drawn, because that atom cannot exist as described.'
      )
    }
    if (degrees[i] !== facts.bonds && degrees[i] > 0) {
      notes.push(`Atom ${i + 1} (${atoms[i].symbol}) has ${degrees[i]} bonds rather than the usual ${facts.bonds}.`)
    }
  }

  if (bonds.length === 0 && atoms.length > 1) {
    notes.push('No bonds came back, so the atoms are drawn without them.')
  } else if (atoms.length > 1) {
    // Everything should be joined to everything else, directly or through other atoms.
    const reached = new Set<number>([0])
    const queue = [0]
    const next = new Map<number, number[]>()
    for (const one of bonds) {
      next.set(one.a, [...(next.get(one.a) ?? []), one.b])
      next.set(one.b, [...(next.get(one.b) ?? []), one.a])
    }
    while (queue.length > 0) {
      const here = queue.shift() as number
      for (const there of next.get(here) ?? []) {
        if (reached.has(there)) continue
        reached.add(there)
        queue.push(there)
      }
    }
    if (reached.size < atoms.length) {
      notes.push(
        `${atoms.length - reached.size} of the ${atoms.length} atoms are not joined to the rest. That is right for an ionic compound and wrong for a molecule.`
      )
    }
  }

  /*
   * No positions, so the geometry is built here -- bond lengths from covalent radii, angles from VSEPR, then
   * relaxed. This is the usual path now, because asking a model for coordinates does not work.
   */
  let placed: readonly Atom[] = atoms
  let builtBy: 'given' | 'computed' = 'given'
  let worstBond = 0
  if (!positioned) {
    const made = build(
      atoms.map((one) => one.symbol),
      bonds
    )
    placed = made.atoms
    builtBy = 'computed'
    worstBond = made.worstBond
    for (const one of made.notes) notes.push(one)
  }

  let across = 0
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      across = Math.max(across, Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y, placed[i].z - placed[j].z))
    }
  }

  return {
    structure: {
      name: String(proposed.name ?? wanted).trim().slice(0, 80) || wanted,
      formula: counted.tidy,
      atoms: placed,
      bonds,
      from,
      geometry: builtBy,
      notes: Object.freeze(notes.slice(0, 8)),
      facts: Object.freeze([`${placed.length} atoms, ${bonds.length} bonds.`])
    },
    counted,
    across,
    degrees,
    worstBond
  }
}

// ---------------------------------------------------------------- asking a model

/**
 * Builds a structure from a SMILES string, checked against a formula.
 *
 * This is the route that actually works. The parser gives exact connectivity with the hydrogens worked out from
 * valence; the formula it comes to is compared with the formula that was expected; and only if those agree is the
 * geometry built. The string and the formula describe the molecule in completely different ways, so a model that
 * recalled one of them wrongly is caught rather than drawn.
 */
export function fromSmiles(
  smiles: string,
  expected: string,
  name: string,
  from: Structure['from'] = 'model'
): Checked | MoleculeProblem {
  const read = readSmiles(smiles)
  if (isSmilesProblem(read)) {
    return no(
      `The SMILES string could not be read: ${read.problem}`,
      read.fix
    )
  }

  const wanted = countFormula(expected)
  if (isMoleculeProblem(wanted)) {
    return no(`The formula to check against is not a formula: ${wanted.problem}`, wanted.fix)
  }

  /*
   * The two must agree.
   *
   * The parsed formula comes from counting the atoms the string actually describes. The expected one was stated
   * separately. A model that recalled the wrong SMILES, or the right SMILES for a different compound, almost
   * always gets one of the two wrong -- and this is where that shows up instead of on screen.
   */
  if (read.formula !== wanted.tidy) {
    return no(
      `The SMILES string is ${read.formula} and the formula given was ${wanted.tidy}.`,
      'Those are different molecules, so neither was drawn. Try the formula on its own, or a more usual name.'
    )
  }

  const made = build(read.symbols, read.bonds.map((one) => ({ a: one.a, b: one.b, order: one.order })))

  const degrees = new Array<number>(read.symbols.length).fill(0)
  for (const one of read.bonds) {
    degrees[one.a] += one.order
    degrees[one.b] += one.order
  }

  let across = 0
  for (let i = 0; i < made.atoms.length; i += 1) {
    for (let j = i + 1; j < made.atoms.length; j += 1) {
      across = Math.max(
        across,
        Math.hypot(made.atoms[i].x - made.atoms[j].x, made.atoms[i].y - made.atoms[j].y, made.atoms[i].z - made.atoms[j].z)
      )
    }
  }

  const notes = [...read.notes, ...made.notes]
  /*
   * Facts, kept apart from the warnings.
   *
   * Putting the ring count in with them turned the badge amber on every molecule that has a ring, which is most
   * of them -- so a perfectly good structure read as having something wrong with it.
   */
  const facts: string[] = []
  if (read.rings.length > 0) {
    const sizes = read.rings.map((one) => one.length).sort((x, y) => x - y)
    facts.push(`${read.rings.length} ring${read.rings.length === 1 ? '' : 's'}: ${sizes.join(', ')} atoms.`)
  }
  facts.push(`${made.atoms.length} atoms, ${read.bonds.length} bonds.`)

  return {
    structure: {
      name: String(name ?? '').trim().slice(0, 80) || wanted.tidy,
      formula: wanted.tidy,
      atoms: made.atoms,
      bonds: read.bonds.map((one) => ({ a: one.a, b: one.b, order: one.order })),
      from,
      geometry: 'computed',
      smiles: String(smiles).trim(),
      notes: Object.freeze(notes.slice(0, 8)),
      facts: Object.freeze(facts.slice(0, 6))
    },
    counted: wanted,
    across,
    degrees,
    worstBond: made.worstBond
  }
}

/** The JSON a model is asked for. Written here so it is one thing and matches what the checking expects. */
export const SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    name: { type: 'string' },
    formula: { type: 'string' },
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { symbol: { type: 'string' } },
        required: ['symbol']
      }
    },
    bonds: {
      type: 'array',
      items: {
        type: 'object',
        properties: { a: { type: 'integer' }, b: { type: 'integer' }, order: { type: 'integer' } },
        required: ['a', 'b', 'order']
      }
    }
  },
  required: ['name', 'formula', 'atoms', 'bonds']
})

/**
 * What a model is asked.
 *
 * Specific about units and indexing, because those are what it gets wrong: positions in picometres and bonds
 * numbered from zero. It is also told to say so rather than invent when it does not know the compound, which it
 * sometimes does — and a refusal is far more useful than a plausible wrong structure.
 */
export function promptFor(asked: string): string {
  return [
    'You are giving the structure of one chemical compound, as a list of its atoms and which of them are bonded.',
    '',
    `The compound: ${asked}`,
    '',
    'Answer with JSON and nothing else:',
    '{"name": "<its usual name>", "formula": "<its molecular formula, like C8H10N4O2>",',
    ' "atoms": [{"symbol": "C"}, {"symbol": "O"}, {"symbol": "H"}, …],',
    ' "bonds": [{"a": 0, "b": 1, "order": 2}, …]}',
    '',
    'Rules:',
    '  - NO coordinates. Do not try to give positions — the geometry is worked out from the bonds.',
    '  - "atoms" lists EVERY atom including every hydrogen, and the count must match the formula exactly.',
    '  - Bonds are indices into "atoms", numbered FROM ZERO. Order is 1 for single, 2 for double, 3 for triple.',
    '  - Give every bond, including the ones to hydrogen. An atom bonded to nothing will be drawn apart from the',
    '    rest, which is right for an ion and wrong for a molecule.',
    '  - For an aromatic ring, alternate 2 and 1 round it.',
    '',
    'If you do not know this compound, or it is not a real compound, answer exactly:',
    '{"unknown": "<one sentence saying why>"}',
    'Do not invent a structure. A wrong one is worse than none, because it cannot be told apart from a right one.'
  ].join('\n')
}

/** Reads a model's reply, finding the JSON inside whatever words came with it. */
export function readReply(text: string): { held: Record<string, unknown> } | MoleculeProblem {
  let cleaned = String(text ?? '').trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
  if (!cleaned.startsWith('{')) {
    const from = cleaned.indexOf('{')
    const to = cleaned.lastIndexOf('}')
    if (from === -1 || to <= from) {
      return no('The answer was not a structure.', 'Nothing in it could be read as one.')
    }
    cleaned = cleaned.slice(from, to + 1)
  }
  let held: unknown
  try {
    held = JSON.parse(cleaned)
  } catch {
    return no('The answer was not readable.', 'It was meant to be JSON and could not be parsed.')
  }
  if (typeof held !== 'object' || held === null) return no('The answer was not a structure.', 'Try a different name for it.')
  const row = held as Record<string, unknown>
  if (typeof row.unknown === 'string' && row.unknown.trim() !== '') {
    // It said it did not know, which is the honest answer and is reported as one.
    return no(`Orion does not have a structure for this: ${row.unknown.trim()}`, 'Try its formula, or a more usual name for it.')
  }
  return { held: row }
}

/**
 * The formula to check a reply against.
 *
 * When what was typed is itself a formula, that is what to check against. When it is a name — "caffeine" — the
 * model's own formula is used, which is weaker but still a check: the atoms it lists must match the formula it
 * stated, so it cannot list a different molecule from the one it named.
 */
export function formulaToCheck(asked: string, reply: Record<string, unknown>): { formula: string; strict: boolean } {
  const typed = countFormula(asked)
  if (!isMoleculeProblem(typed)) return { formula: asked, strict: true }
  const theirs = String(reply.formula ?? '').trim()
  return { formula: theirs, strict: false }
}

/** What the checking is and is not, for a screen to show beside a structure. */
export const aboutThis: readonly string[] = Object.freeze([
  'A structure from Orbis’s own table is exact. One worked out by Orion is checked against the formula, against how many bonds each element can make, and against whether the geometry is a geometry — but it is still a model’s answer, not a measurement.',
  'The check that matters most is the atom count, because the commonest invention is the right molecule with one hydrogen missing. It is done against the formula parsed here, which does not come from the model.',
  'Nothing is repaired. A structure that fails a check is reported with the reason rather than quietly corrected, because a corrected structure carries the model’s authority without its content.',
  'Bond lengths that look long for the elements involved are reported and still drawn. An atom with more bonds than its element can make is refused outright.',
  'These are drawn from coordinates, not computed from quantum mechanics. For the real geometry of a molecule nobody has measured, this is a plausible arrangement and not a prediction.'
])
