/**
 * Reading SMILES into atoms and bonds.
 *
 * ## Why SMILES
 *
 * Asked for a molecule's coordinates, a model refuses — truthfully. Asked for a bond list with indices, it also
 * refuses, or miscounts: numbering twenty-four atoms by hand and then referring to them consistently is exactly
 * the kind of bookkeeping a model is worst at.
 *
 * SMILES is the form it is reliable at. `CN1C=NC2=C1C(=O)N(C)C(=O)N2C` is caffeine, it appears in every chemical
 * database and every paper, there are no indices to miscount, and it is short enough to be recalled rather than
 * reconstructed. And it is deterministic to read: this file turns it into exact connectivity, with the hydrogens
 * worked out from valence, and the result is checked against the molecular formula before anything is drawn.
 *
 * So the division of labour is: the model recalls a string, this parses it, `geometry.ts` places the atoms, and
 * `molecule.ts` checks the whole thing against the formula. Each part does what it is actually good at.
 *
 * ## What it reads
 *
 * The organic subset — B C N O P S F Cl Br I and their lower-case aromatic forms — plus bracketed atoms with
 * charges and explicit hydrogen counts, branches, ring closures including %nn, and the bond symbols - = # : and
 * the dot for a disconnected part. Stereochemistry (@, /, \\) is read and discarded, because this draws a shape
 * and does not claim to draw the right enantiomer.
 */

export interface SmilesProblem {
  problem: string
  /** Where in the string, so a screen can point at it. */
  at?: number
  fix: string
}

export const isSmilesProblem = (held: unknown): held is SmilesProblem =>
  typeof held === 'object' && held !== null && 'problem' in held

const no = (problem: string, fix: string, at?: number): SmilesProblem => ({ problem, fix, ...(at !== undefined ? { at } : {}) })

export interface SmilesAtom {
  symbol: string
  /** True for a lower-case aromatic atom. */
  aromatic: boolean
  /** Formal charge, usually zero. */
  charge: number
  /** Hydrogens stated inside brackets. Null when none were stated and they are to be worked out. */
  statedHydrogens: number | null
}

export interface SmilesBond {
  a: number
  b: number
  /** 1, 2 or 3. An aromatic bond is reported as its Kekulé order. */
  order: 1 | 2 | 3
  /** True when the bond came from two aromatic atoms rather than an explicit = or #. */
  aromatic: boolean
}

export interface Read {
  /** Heavy atoms and the hydrogens, in that order — hydrogens are appended as they are worked out. */
  symbols: readonly string[]
  bonds: readonly SmilesBond[]
  /** How many of each element, which is what the formula is checked against. */
  counts: Readonly<Record<string, number>>
  /** The formula in Hill order. */
  formula: string
  /** Rings found, as lists of atom indices. */
  rings: readonly (readonly number[])[]
  /** What was read and discarded, or noticed and allowed. */
  notes: readonly string[]
}

/** The elements that may be written without brackets, and the valences they fill to. */
const ORGANIC: Readonly<Record<string, readonly number[]>> = Object.freeze({
  B: [3],
  C: [4],
  N: [3, 5],
  O: [2],
  P: [3, 5],
  S: [2, 4, 6],
  F: [1],
  Cl: [1],
  Br: [1],
  I: [1]
})

/** Valences for anything that may appear in brackets. Only what is needed to fill hydrogens. */
const VALENCE: Readonly<Record<string, readonly number[]>> = Object.freeze({
  ...ORGANIC,
  H: [1],
  Li: [1], Be: [2], Na: [1], Mg: [2], Al: [3], Si: [4], K: [1], Ca: [2],
  Ti: [4], Cr: [3], Mn: [2], Fe: [2, 3], Co: [2], Ni: [2], Cu: [1, 2], Zn: [2],
  Se: [2, 4, 6], Ag: [1], Ba: [2], Pt: [2, 4], Au: [1, 3], Hg: [1, 2], Pb: [2, 4]
})

/**
 * Reads a SMILES string.
 *
 * Refuses rather than repairs. An unclosed ring, an unmatched bracket or an element symbol nobody knows each
 * means the string is not the molecule somebody meant, and guessing which molecule they did mean would be
 * inventing one.
 */
export function readSmiles(text: string): Read | SmilesProblem {
  const s = String(text ?? '').trim().replace(/\s+/g, '')
  if (s === '') return no('Nothing to read.', 'A SMILES string is needed.')
  if (s.length > 600) return no('That string is longer than this reads.', 'Try a smaller molecule.')

  const atoms: SmilesAtom[] = []
  const bonds: SmilesBond[] = []
  const notes: string[] = []
  const branch: number[] = []
  /** Open ring closures: the label, the atom waiting, and the bond order it was opened with. */
  const open = new Map<string, { at: number; order: 1 | 2 | 3 | null; aromatic: boolean }>()
  const rings: number[][] = []

  let previous: number | null = null
  let pendingOrder: 1 | 2 | 3 | null = null
  let pendingAromatic = false
  /** Set by a dot: the next atom starts a new fragment and is not bonded to the last one. */
  let broken = false
  let i = 0

  const join = (a: number, b: number, order: 1 | 2 | 3, aromatic: boolean): void => {
    if (a === b) return
    if (bonds.some((one) => (one.a === a && one.b === b) || (one.a === b && one.b === a))) return
    bonds.push({ a, b, order, aromatic })
  }

  while (i < s.length) {
    const ch = s[i]

    // ---------------------------------------------------------------- bonds and structure
    if (ch === '-' || ch === '=' || ch === '#' || ch === ':' || ch === '/' || ch === '\\') {
      if (ch === '/' || ch === '\\') {
        if (!notes.includes('Double-bond stereochemistry was read and left out; this draws a shape, not a given isomer.')) {
          notes.push('Double-bond stereochemistry was read and left out; this draws a shape, not a given isomer.')
        }
        pendingOrder = pendingOrder ?? 1
      } else if (ch === ':') {
        pendingOrder = 1
        pendingAromatic = true
      } else {
        pendingOrder = ch === '=' ? 2 : ch === '#' ? 3 : 1
      }
      i += 1
      continue
    }
    if (ch === '.') {
      broken = true
      previous = null
      i += 1
      continue
    }
    if (ch === '(') {
      if (previous === null) return no('A branch opened before any atom.', 'A branch has to hang off something.', i)
      branch.push(previous)
      i += 1
      continue
    }
    if (ch === ')') {
      const back = branch.pop()
      if (back === undefined) return no('A branch closed that was never opened.', 'Check the brackets match.', i)
      previous = back
      i += 1
      continue
    }

    // ---------------------------------------------------------------- ring closures
    if (/[1-9]/.test(ch) || ch === '%') {
      let label: string
      if (ch === '%') {
        const two = s.slice(i + 1, i + 3)
        if (!/^\d\d$/.test(two)) return no('A %nn ring label needs two digits after it.', 'Write %10, not %1.', i)
        label = two
        i += 3
      } else {
        label = ch
        i += 1
      }
      if (previous === null) return no(`Ring closure ${label} came before any atom.`, 'A ring has to start at an atom.', i)
      const waiting = open.get(label)
      if (waiting === undefined) {
        open.set(label, { at: previous, order: pendingOrder, aromatic: pendingAromatic })
      } else {
        // The order from either end; aromatic if either end said so or both atoms are aromatic.
        const order = (pendingOrder ?? waiting.order ?? 1) as 1 | 2 | 3
        const aromatic =
          pendingAromatic || waiting.aromatic || (atoms[previous].aromatic && atoms[waiting.at].aromatic)
        join(waiting.at, previous, order, aromatic)
        rings.push([waiting.at, previous])
        open.delete(label)
      }
      pendingOrder = null
      pendingAromatic = false
      continue
    }

    // ---------------------------------------------------------------- a bracketed atom
    if (ch === '[') {
      const close = s.indexOf(']', i)
      if (close === -1) return no('A square bracket was opened and never closed.', 'Check the brackets match.', i)
      const inside = s.slice(i + 1, close)
      const read = readBracket(inside, i)
      if (isSmilesProblem(read)) return read
      const index = atoms.length
      atoms.push(read)
      if (previous !== null && !broken) {
        const aromatic = pendingAromatic || (atoms[previous].aromatic && read.aromatic)
        join(previous, index, (pendingOrder ?? 1) as 1 | 2 | 3, aromatic)
      }
      previous = index
      pendingOrder = null
      pendingAromatic = false
      broken = false
      i = close + 1
      continue
    }

    // ---------------------------------------------------------------- an organic-subset atom
    const two = s.slice(i, i + 2)
    let symbol: string | null = null
    let aromatic = false
    if (two === 'Cl' || two === 'Br') {
      symbol = two
      i += 2
    } else if (/^[BCNOPSFI]$/.test(ch)) {
      symbol = ch
      i += 1
    } else if (/^[bcnopsf]$/.test(ch)) {
      // Lower case is aromatic. Only these have a lower-case form in the organic subset.
      symbol = ch.toUpperCase()
      aromatic = true
      i += 1
    } else if (ch === '*') {
      return no('A wildcard atom cannot be drawn.', 'Give the actual element.', i)
    } else if (ch === '@') {
      // Stereochemistry outside brackets is not valid SMILES, but it is written; read and drop it.
      i += 1
      continue
    } else {
      return no(`"${ch}" is not something a SMILES string can contain here.`, 'Check the string.', i)
    }

    const index = atoms.length
    atoms.push({ symbol, aromatic, charge: 0, statedHydrogens: null })
    if (previous !== null && !broken) {
      const bothAromatic = atoms[previous].aromatic && aromatic
      join(previous, index, (pendingOrder ?? 1) as 1 | 2 | 3, pendingAromatic || bothAromatic)
    }
    previous = index
    pendingOrder = null
    pendingAromatic = false
    broken = false
  }

  if (branch.length > 0) return no(`${branch.length} branch${branch.length === 1 ? '' : 'es'} left open.`, 'Check the round brackets match.')
  if (open.size > 0) {
    const labels = [...open.keys()].join(', ')
    return no(`Ring closure${open.size === 1 ? '' : 's'} ${labels} never closed.`, 'Every ring number appears twice.')
  }
  if (atoms.length === 0) return no('No atoms were found in it.', 'Check the string.')

  // ---------------------------------------------------------------- aromatic rings get Kekulé orders
  const aromaticNote = assignKekule(atoms, bonds)
  if (aromaticNote) notes.push(aromaticNote)

  // ---------------------------------------------------------------- the hydrogens
  const symbols = atoms.map((one) => one.symbol)
  const hydrogens: { on: number }[] = []

  for (const [index, atom] of atoms.entries()) {
    if (atom.symbol === 'H') continue
    let used = 0
    for (const one of bonds) {
      if (one.a === index || one.b === index) used += one.order
    }
    let want: number
    if (atom.statedHydrogens !== null) {
      want = atom.statedHydrogens
    } else {
      const options = VALENCE[atom.symbol]
      if (!options) {
        notes.push(`${atom.symbol} has no valence here, so no hydrogens were added to it.`)
        want = 0
      } else {
        // The lowest valence that covers what is already used, adjusted for charge.
        const target = options.find((one) => one + atom.charge >= used) ?? options[options.length - 1]
        want = Math.max(0, target + atom.charge - used)
      }
    }
    for (let k = 0; k < want; k += 1) hydrogens.push({ on: index })
  }

  for (const one of hydrogens) {
    const index = symbols.length
    symbols.push('H')
    bonds.push({ a: one.on, b: index, order: 1, aromatic: false })
  }

  const counts: Record<string, number> = {}
  for (const one of symbols) counts[one] = (counts[one] ?? 0) + 1

  return {
    symbols,
    bonds,
    counts: Object.freeze(counts),
    formula: hill(counts),
    rings: Object.freeze(ringsOf(symbols.length, bonds).map((one) => Object.freeze(one))),
    notes: Object.freeze(notes.slice(0, 6))
  }
}

/** One bracketed atom: `[nH]`, `[O-]`, `[Fe+2]`, `[13C]`. */
function readBracket(inside: string, at: number): SmilesAtom | SmilesProblem {
  let text = inside
  // An isotope number in front is read and dropped: it changes the mass, not the shape.
  text = text.replace(/^\d+/, '')
  // Stereochemistry, dropped for the same reason.
  text = text.replace(/@+/g, '')
  if (text === '') return no(`"[${inside}]" has no element in it.`, 'A bracketed atom needs a symbol.', at)

  const symbolMatch = /^([A-Za-z][a-z]?)/.exec(text)
  if (!symbolMatch) return no(`"[${inside}]" does not start with an element symbol.`, 'Check the string.', at)
  let symbol = symbolMatch[1]
  let aromatic = false
  if (/^[a-z]/.test(symbol)) {
    aromatic = true
    symbol = symbol[0].toUpperCase() + symbol.slice(1)
  }
  // "Sn" is tin, but "Se" written aromatic is "se" -- the capitalisation is already handled above.
  if (!Object.prototype.hasOwnProperty.call(VALENCE, symbol)) {
    // One letter may be the real symbol with a following H count: [nH] is aromatic nitrogen with one hydrogen.
    const oneLetter = symbol[0]
    if (Object.prototype.hasOwnProperty.call(VALENCE, oneLetter)) {
      symbol = oneLetter
      text = symbolMatch[1].slice(1) + text.slice(symbolMatch[1].length)
    } else {
      return no(`"${symbol}" is not an element this knows.`, 'Check the symbol.', at)
    }
  } else {
    text = text.slice(symbolMatch[1].length)
  }

  let statedHydrogens: number | null = null
  const hMatch = /^H(\d*)/.exec(text)
  if (hMatch) {
    statedHydrogens = hMatch[1] === '' ? 1 : Number(hMatch[1])
    text = text.slice(hMatch[0].length)
  }

  let charge = 0
  const chargeMatch = /^([+-])(\d*)/.exec(text)
  if (chargeMatch) {
    const size = chargeMatch[2] === '' ? 1 : Number(chargeMatch[2])
    charge = chargeMatch[1] === '+' ? size : -size
    text = text.slice(chargeMatch[0].length)
  }
  // Repeated signs, as in [Fe++].
  const more = /^([+-]+)/.exec(text)
  if (more) {
    charge += more[1].split('').reduce((sum, one) => sum + (one === '+' ? 1 : -1), 0)
    text = text.slice(more[1].length)
  }

  // A bracketed atom with no stated hydrogens has none: that is what the brackets mean in SMILES.
  if (statedHydrogens === null) statedHydrogens = 0

  return { symbol, aromatic, charge, statedHydrogens }
}

/**
 * Turns aromatic bonds into alternating single and double ones.
 *
 * A drawing needs a bond order, and "aromatic" is not one. Alternating round each ring is the Kekulé structure,
 * which is what gives benzene three double bonds and the right number of hydrogens on each carbon. Where a ring
 * has an odd number of atoms, or an atom already carries a double bond, that atom is left single — pyrrole and
 * imidazole need that, and forcing a double bond on them would add a hydrogen that is not there.
 */
function assignKekule(atoms: readonly SmilesAtom[], bonds: SmilesBond[]): string | null {
  const aromatic = bonds.filter((one) => one.aromatic)
  if (aromatic.length === 0) return null

  /*
   * How much valence each aromatic atom has left for a double bond.
   *
   * An atom with none cannot be in one. Pyrrole's nitrogen is the case that matters: it carries a hydrogen and
   * two ring bonds, which fills it, so the four carbons have to pair among themselves — and which pairs are
   * possible is what decides whether the formula comes out right.
   */
  const spare = new Map<number, number>()
  const inAromatic = new Set<number>()
  for (const one of aromatic) {
    inAromatic.add(one.a)
    inAromatic.add(one.b)
  }
  for (const index of inAromatic) {
    const atom = atoms[index]
    let used = 0
    for (const one of bonds) {
      if (one.a === index || one.b === index) used += one.order
    }
    used += atom.statedHydrogens ?? 0
    const options = VALENCE[atom.symbol] ?? [0]
    // The lowest valence that covers what is already used, so a sulfur in a ring is not treated as six-valent.
    const target = options.find((one) => one + atom.charge >= used) ?? options[options.length - 1]
    spare.set(index, Math.max(0, target + atom.charge - used))
  }
  // An atom already in an explicit double or triple bond is full as far as this is concerned.
  for (const one of bonds) {
    if (one.aromatic || one.order < 2) continue
    spare.set(one.a, 0)
    spare.set(one.b, 0)
  }

  /*
   * Maximum matching on the aromatic bonds, by augmenting paths.
   *
   * Each matched pair becomes one double bond. Taking the bonds in written order instead gets pyrrole wrong, so
   * this is solved rather than approximated — the graphs are a handful of atoms and it is instant.
   */
  const canPair: number[][] = []
  const edgeOf = new Map<string, SmilesBond>()
  for (const one of aromatic) {
    if ((spare.get(one.a) ?? 0) < 1 || (spare.get(one.b) ?? 0) < 1) continue
    while (canPair.length <= Math.max(one.a, one.b)) canPair.push([])
    canPair[one.a].push(one.b)
    canPair[one.b].push(one.a)
    edgeOf.set(one.a < one.b ? `${one.a}-${one.b}` : `${one.b}-${one.a}`, one)
  }

  const partner = new Map<number, number>()

  const tryToPair = (here: number, visited: Set<number>): boolean => {
    for (const there of canPair[here] ?? []) {
      if (visited.has(there)) continue
      visited.add(there)
      const taken = partner.get(there)
      // Free, or its current partner can be re-paired elsewhere.
      if (taken === undefined || tryToPair(taken, visited)) {
        partner.set(here, there)
        partner.set(there, here)
        return true
      }
    }
    return false
  }

  // Atoms with the fewest choices first: a nitrogen with one possible partner must take it.
  const order = [...inAromatic]
    .filter((one) => (spare.get(one) ?? 0) >= 1)
    .sort((x, y) => (canPair[x]?.length ?? 0) - (canPair[y]?.length ?? 0))

  for (const here of order) {
    if (partner.has(here)) continue
    tryToPair(here, new Set([here]))
  }

  let made = 0
  const done = new Set<number>()
  for (const [a, b] of partner) {
    if (done.has(a) || done.has(b)) continue
    done.add(a)
    done.add(b)
    const edge = edgeOf.get(a < b ? `${a}-${b}` : `${b}-${a}`)
    if (!edge) continue
    edge.order = 2
    made += 1
  }

  /*
   * Any aromatic atom left unpaired keeps a single bond and takes a hydrogen instead.
   *
   * That is right for pyrrole's nitrogen and for a furan oxygen, and it is what the valence calculation
   * afterwards does with it. It is only worth a note when nothing could be paired at all, which means the ring
   * was not aromatic in any sense this can draw.
   */
  const unpaired = [...inAromatic].filter((one) => !partner.has(one) && (spare.get(one) ?? 0) >= 1)
  if (made === 0) {
    return 'The aromatic bonds were all left single, because no two of their atoms had room for a double bond.'
  }
  if (unpaired.length > 1) {
    return `${unpaired.length} atoms in the aromatic rings could not be paired into double bonds, so they take hydrogens instead.`
  }
  return null
}

/** Rings in the structure, as lists of atoms. Found by depth-first search, smallest first. */
function ringsOf(n: number, bonds: readonly SmilesBond[]): number[][] {
  const near: number[][] = Array.from({ length: n }, () => [])
  for (const one of bonds) {
    if (one.a < n && one.b < n) {
      near[one.a].push(one.b)
      near[one.b].push(one.a)
    }
  }
  const found: number[][] = []
  const seenKeys = new Set<string>()

  // Shortest cycle through each atom, which finds each ring once per atom and is then de-duplicated.
  for (let start = 0; start < n; start += 1) {
    const from = new Map<number, number>([[start, -1]])
    const depth = new Map<number, number>([[start, 0]])
    const queue = [start]
    while (queue.length > 0) {
      const here = queue.shift() as number
      for (const there of near[here]) {
        if (there === from.get(here)) continue
        if (!depth.has(there)) {
          depth.set(there, (depth.get(here) ?? 0) + 1)
          from.set(there, here)
          queue.push(there)
          continue
        }
        // A back edge: walk both ends up to their meeting point for the cycle.
        const ring = new Set<number>()
        let a = here
        let b = there
        while (a !== b && a !== undefined && b !== undefined) {
          if ((depth.get(a) ?? 0) >= (depth.get(b) ?? 0)) {
            ring.add(a)
            a = from.get(a) as number
          } else {
            ring.add(b)
            b = from.get(b) as number
          }
        }
        if (a !== undefined) ring.add(a)
        if (ring.size >= 3 && ring.size <= 12) {
          const key = [...ring].sort((x, y) => x - y).join(',')
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            found.push([...ring])
          }
        }
      }
    }
  }
  return found.sort((x, y) => x.length - y.length)
}

/** Hill order: carbon, hydrogen, then the rest alphabetically. */
function hill(counts: Readonly<Record<string, number>>): string {
  const rest = Object.keys(counts).filter((one) => one !== 'C' && one !== 'H').sort()
  const order = [...(counts.C ? ['C'] : []), ...(counts.H ? ['H'] : []), ...rest]
  return order.map((one) => `${one}${counts[one] > 1 ? counts[one] : ''}`).join('')
}

/**
 * What a model is asked. One string, which is what it is reliably able to give.
 *
 * It is told to give nothing else, because a SMILES string wrapped in an explanation is still parseable but a
 * SMILES string it has decided to "improve" is not the molecule that was asked for.
 */
export function promptForSmiles(asked: string): string {
  return [
    'Give the SMILES string for one chemical compound, and its molecular formula.',
    '',
    `The compound: ${asked}`,
    '',
    'Answer with JSON and nothing else:',
    '{"name": "<its usual name>", "formula": "<molecular formula, like C8H10N4O2>", "smiles": "<the SMILES>"}',
    '',
    'Rules:',
    '  - The SMILES must be the standard one for this compound, as it appears in a chemical database.',
    '  - Do not add hydrogens explicitly unless SMILES requires them; they are worked out from valence.',
    '  - The formula must be the compound’s real molecular formula. It is used to check the SMILES, so an',
    '    inconsistent pair is caught and refused rather than drawn.',
    '',
    'Examples of the form:',
    '  caffeine  -> {"name": "Caffeine", "formula": "C8H10N4O2", "smiles": "CN1C=NC2=C1C(=O)N(C)C(=O)N2C"}',
    '  aspirin   -> {"name": "Aspirin", "formula": "C9H8O4", "smiles": "CC(=O)Oc1ccccc1C(=O)O"}',
    '  glucose   -> {"name": "Glucose", "formula": "C6H12O6", "smiles": "OCC1OC(O)C(O)C(O)C1O"}',
    '',
    'If you do not know this compound, or it is not a real compound, answer exactly:',
    '{"unknown": "<one sentence saying why>"}',
    'Do not invent a SMILES string. A wrong one draws a wrong molecule that cannot be told from a right one.'
  ].join('\n')
}

/** What this reads and what it leaves out, for a screen to show rather than a manual. */
export const aboutThis: readonly string[] = Object.freeze([
  'SMILES is the form a model can actually give: it is in every chemical database, it is short enough to be recalled rather than reconstructed, and it has no atom numbering to miscount.',
  'The hydrogens are worked out from valence rather than taken on trust, and the whole thing is checked against the molecular formula before a single atom is placed. An inconsistent pair is refused.',
  'Aromatic bonds are given alternating single and double orders — the Kekulé structure — because a drawing needs a bond order and "aromatic" is not one. The real molecule has them all the same.',
  'Stereochemistry is read and discarded. This draws a shape; it does not claim to draw the right enantiomer or the right geometric isomer.',
  'Isotope labels are dropped: they change the mass, not the shape.'
])
