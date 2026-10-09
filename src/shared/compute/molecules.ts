import { elementBy, isChemistryError, type Element } from './chemistry.ts'

/**
 * Molecules as structured data: atoms, bonds, geometry.
 *
 * ## Why this exists when `chemistry.ts` already does
 *
 * `chemistry.ts` holds the periodic table and parses formulas — it can tell you that H₂O weighs 18.015 g/mol. It
 * has no notion of *which atom is bonded to which*, and a great deal of chemistry is exactly that: a molecule's
 * shape, its polarity, whether a structure is even possible. Ethanol and dimethyl ether are both C₂H₆O and are
 * different substances. A formula cannot tell them apart; a connectivity graph can.
 *
 * So this is a molecular graph, and the periodic data is read from `chemistry.ts` rather than restated — atomic
 * weights are measurements and there must be one copy of them.
 *
 * ## Valence is checked, and a refusal is the useful answer
 *
 * The brief asks that obviously invalid chemistry is not silently accepted. Adding a third hydrogen to water is
 * refused with the reason — oxygen's two bonding positions are already used — because "it looks wrong" is not
 * something a picture can convey and a sentence can.
 *
 * The check is the octet-and-common-valence rule, which is what school and undergraduate chemistry use. It is
 * deliberately not quantum chemistry: hypervalent sulphur, electron-deficient boron and transition-metal
 * coordination all exist, so those are reported as *unusual* rather than refused, with the reason. A model that
 * refused SF₆ would be teaching something false.
 *
 * ## Geometry is VSEPR, and says so
 *
 * The shapes and angles here come from valence-shell electron-pair repulsion, which predicts the right geometry for
 * most small molecules and is an approximation. The bond angles it gives are the idealised ones; real angles differ
 * (water is 104.5° and not the tetrahedral 109.5°, because lone pairs repel more than bonds). Where a measured
 * angle is known it is given, labelled as measured. Nothing here claims to be a calculation from first principles.
 *
 * Pure. No clock, no randomness.
 */

export interface MoleculeError {
  error: string
  message: string
  /** What to do about it. Never "try again". */
  fix: string
}

export const isMoleculeError = (value: unknown): value is MoleculeError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value && 'fix' in value

const fail = (error: string, message: string, fix: string): MoleculeError => ({ error, message, fix })

export const MOLECULE_LIMITS = Object.freeze({ atoms: 300, bonds: 600, ringSize: 40 })

// ---------------------------------------------------------------- atoms and bonds

export interface Atom {
  /** Stable within a molecule. Bonds refer to these, never to positions in an array. */
  id: string
  symbol: string
  /** Formal charge, as the structure is drawn. Zero unless set. */
  charge: number
  /** Explicit lone pairs, when the structure specifies them. Worked out when it does not. */
  lonePairs?: number
  /** Where it sits, once geometry has been worked out. Ångströms. */
  at?: { x: number; y: number; z: number }
  label?: string
}

/** 1 single, 2 double, 3 triple. Aromatic rings are described as alternating, with `aromatic` set. */
export type BondOrder = 1 | 2 | 3

export interface Bond {
  id: string
  from: string
  to: string
  order: BondOrder
  /** True for a bond that is part of a delocalised ring. Its order is then the Kekulé one. */
  aromatic?: boolean
}

export interface Molecule {
  name?: string
  atoms: readonly Atom[]
  bonds: readonly Bond[]
  /** Overall charge, when the molecule is an ion. Checked against the formal charges. */
  charge: number
}

export const EMPTY_MOLECULE: Molecule = Object.freeze({ atoms: Object.freeze([]), bonds: Object.freeze([]), charge: 0 })

// ---------------------------------------------------------------- valence

/**
 * How many bonds an element normally makes, and how many it can.
 *
 * `usual` is the common valence; `allowed` lists every count the **neutral** atom takes. Sulphur is the clearest
 * case: usually two, and six in SF₆, so both are listed and neither is refused.
 *
 * Neutral, deliberately. A charge shifts the whole range — oxygen takes two bonds neutral, three at +1 (H₃O⁺) and
 * one at −1 (OH⁻) — and `checkValence` adds the formal charge rather than the table listing every charged case.
 * Listing 3 for neutral oxygen would accept OH₃, which is not a thing, while H₃O⁺ is.
 *
 * Elements not listed here — the transition metals especially — have variable coordination, and `checkValence`
 * reports them as unchecked rather than guessing a rule that does not exist.
 */
const VALENCE: Readonly<Record<string, { usual: number; allowed: readonly number[] }>> = Object.freeze({
  H: { usual: 1, allowed: [1] },
  He: { usual: 0, allowed: [0] },
  Li: { usual: 1, allowed: [1] },
  Be: { usual: 2, allowed: [2] },
  B: { usual: 3, allowed: [3] },
  C: { usual: 4, allowed: [4] },
  N: { usual: 3, allowed: [3] },
  O: { usual: 2, allowed: [2] },
  F: { usual: 1, allowed: [1] },
  Ne: { usual: 0, allowed: [0] },
  Na: { usual: 1, allowed: [1] },
  Mg: { usual: 2, allowed: [2] },
  Al: { usual: 3, allowed: [3] },
  Si: { usual: 4, allowed: [4] },
  P: { usual: 3, allowed: [3, 5] },
  S: { usual: 2, allowed: [2, 4, 6] },
  Cl: { usual: 1, allowed: [1, 3, 5, 7] },
  Ar: { usual: 0, allowed: [0] },
  K: { usual: 1, allowed: [1] },
  Ca: { usual: 2, allowed: [2] },
  Br: { usual: 1, allowed: [1, 3, 5, 7] },
  I: { usual: 1, allowed: [1, 3, 5, 7] }
})

export interface AtomCheck {
  atomId: string
  symbol: string
  /** Bond orders added up: a double bond counts twice. */
  used: number
  usual: number | null
  /**
   * What the bond count means.
   *
   * `incomplete` is its own verdict and not a failure. An O-H fragment has one bond where oxygen usually has two,
   * and that is a half-built structure or a radical -- both real things. Only exceeding what an atom can hold is
   * impossible, so only `wrong` makes a structure refuse.
   */
  verdict: 'fine' | 'incomplete' | 'unusual' | 'wrong' | 'unchecked'
  says: string
}

export interface ValenceReport {
  atoms: readonly AtomCheck[]
  /** True when nothing is 'wrong'. An 'unusual' or 'incomplete' structure is still a structure. */
  possible: boolean
  /** True when every atom has exactly its usual bonding -- a finished, ordinary molecule. */
  complete: boolean
  /** Said once, for the whole molecule. */
  summary: string
}

/** Bond orders at an atom, added up. A double bond uses two of its positions. */
export function bondsAt(molecule: Molecule, atomId: string): number {
  let used = 0
  for (const bond of molecule.bonds) {
    if (bond.from === atomId) used += bond.order
    if (bond.to === atomId) used += bond.order
  }
  return used
}

/**
 * Whether every atom's bonding is chemically possible.
 *
 * Three verdicts rather than two, because chemistry has three cases: the usual valence, a real but uncommon one, and
 * one that cannot happen. Collapsing the middle into either of the others would mean either refusing SF₆ or
 * accepting CH₅.
 */
export function checkValence(molecule: Molecule): ValenceReport {
  const atoms: AtomCheck[] = []

  for (const atom of molecule.atoms) {
    const used = bondsAt(molecule, atom.id)
    const rule = VALENCE[atom.symbol]

    if (!rule) {
      atoms.push({
        atomId: atom.id,
        symbol: atom.symbol,
        used,
        usual: null,
        verdict: 'unchecked',
        says: `${atom.symbol} has variable coordination, so Orbis does not judge its bond count. It has ${used}.`
      })
      continue
    }

    /*
     * A formal charge changes how many bonds an atom makes.
     *
     * Ammonium's nitrogen is +1 and makes four bonds; hydroxide's oxygen is −1 and makes one. Ignoring the charge
     * would refuse both of those, which are two of the commonest ions there are.
     */
    const wanted = rule.usual + atom.charge
    const allowed = rule.allowed.map((one) => one + atom.charge).filter((one) => one >= 0)

    if (used === wanted) {
      atoms.push({ atomId: atom.id, symbol: atom.symbol, used, usual: wanted, verdict: 'fine', says: `${atom.symbol} has its usual ${used}.` })
    } else if (used < Math.min(...allowed, wanted)) {
      /*
       * Fewer bonds than the smallest it normally makes.
       *
       * Not an error: this is what a molecule looks like while it is being built, and what a radical looks like
       * permanently. Refusing it would make the builder impossible to use -- the first bond of water would fail.
       */
      atoms.push({
        atomId: atom.id,
        symbol: atom.symbol,
        used,
        usual: wanted,
        verdict: 'incomplete',
        says: `${atom.symbol} has ${used} bond${used === 1 ? '' : 's'} and usually has ${wanted}. Unfinished, or a radical.`
      })
    } else if (used <= Math.max(...allowed, 0)) {
      /*
       * More than usual but not more than it can hold.
       *
       * Two cases, both real and neither impossible: a count the element genuinely takes (sulphur's six in SF6), and
       * a count between two of them, which is a radical -- SF3 and SF5 exist. Refusing the second would also make
       * SF6 unbuildable, because building it passes through three bonds on the way to six.
       */
      const known = allowed.includes(used)
      atoms.push({
        atomId: atom.id,
        symbol: atom.symbol,
        used,
        usual: wanted,
        verdict: 'unusual',
        says: known
          ? `${atom.symbol} has ${used} bonds. That happens — it usually has ${wanted} — so this is unusual rather than impossible.`
          : `${atom.symbol} has ${used} bonds, between the ${allowed.join(' and ')} it normally takes. That is a radical.`
      })
    } else {
      const most = Math.max(...allowed, 0)
      atoms.push({
        atomId: atom.id,
        symbol: atom.symbol,
        used,
        usual: wanted,
        verdict: 'wrong',
        says: `${atom.symbol} has ${used} bonds and cannot have more than ${most}${atom.charge !== 0 ? ` at a charge of ${atom.charge > 0 ? '+' : ''}${atom.charge}` : ''}.`
      })
    }
  }

  const wrong = atoms.filter((one) => one.verdict === 'wrong')
  const unusual = atoms.filter((one) => one.verdict === 'unusual')
  const incomplete = atoms.filter((one) => one.verdict === 'incomplete')
  const summary =
    wrong.length > 0
      ? `This structure cannot exist: ${wrong.map((one) => one.says).join(' ')}`
      : unusual.length > 0
        ? `Possible, with something uncommon in it: ${unusual.map((one) => one.says).join(' ')}`
        : incomplete.length > 0
          ? `Unfinished: ${incomplete.map((one) => one.says).join(' ')}`
          : 'Every atom has its usual bonding.'

  return { atoms, possible: wrong.length === 0, complete: wrong.length === 0 && unusual.length === 0 && incomplete.length === 0, summary }
}

// ---------------------------------------------------------------- formula and mass

export interface FormulaReport {
  /** Hill order: carbon, then hydrogen, then everything else alphabetically. The convention chemistry uses. */
  formula: string
  counts: Readonly<Record<string, number>>
  /** g/mol, from the IUPAC standard atomic weights in `chemistry.ts`. */
  molarMass: number
  /** True when any element's weight is a conventional value rather than a precise one. */
  conventional: boolean
  /** The elements whose weight is conventional, so a precise claim can be avoided. */
  conventionalFor: readonly string[]
}

/**
 * The molecular formula and mass.
 *
 * Hill order, because that is what chemistry writes: C first, H second, the rest alphabetical. Writing H₂O as
 * "OH₂" would be correct arithmetic and wrong convention.
 */
export function formulaOf(molecule: Molecule): FormulaReport | MoleculeError {
  if (molecule.atoms.length === 0) return fail('empty', 'There are no atoms in this molecule.', 'Add an atom.')

  const counts: Record<string, number> = {}
  let mass = 0
  const conventionalFor: string[] = []

  for (const atom of molecule.atoms) {
    const element = elementBy(atom.symbol)
    if (isChemistryError(element)) {
      return fail('unknown-element', `"${atom.symbol}" is not an element Orbis knows.`, 'Check the symbol — they are case sensitive, so Co is cobalt and CO is carbon monoxide.')
    }
    counts[atom.symbol] = (counts[atom.symbol] ?? 0) + 1
    const weight = element.atomicWeight ?? element.conventionalMass
    if (weight === null) {
      return fail(
        'no-weight',
        `${element.name} has no single atomic weight, so a molecular mass cannot be given.`,
        'Use an isotope-specific mass instead, or leave this element out of a mass calculation.'
      )
    }
    mass += weight
    // A wide published interval means the value is conventional, and a precise mass claim should say so.
    if ((element.weightUncertainty ?? 0) > 0.001 && !conventionalFor.includes(element.symbol)) conventionalFor.push(element.symbol)
  }

  const symbols = Object.keys(counts)
  const ordered = [
    ...(counts.C ? ['C'] : []),
    ...(counts.H ? ['H'] : []),
    ...symbols.filter((one) => one !== 'C' && one !== 'H').sort()
  ]
  const formula = ordered.map((one) => (counts[one] === 1 ? one : `${one}${counts[one]}`)).join('')

  return {
    formula,
    counts: Object.freeze(counts),
    molarMass: Number(mass.toFixed(4)),
    conventional: conventionalFor.length > 0,
    conventionalFor
  }
}

// ---------------------------------------------------------------- geometry

export type Shape =
  | 'single atom'
  | 'linear'
  | 'bent'
  | 'trigonal planar'
  | 'trigonal pyramidal'
  | 'tetrahedral'
  | 'trigonal bipyramidal'
  | 'seesaw'
  | 'T-shaped'
  | 'octahedral'
  | 'square pyramidal'
  | 'square planar'
  | 'unknown'

export interface GeometryReport {
  atomId: string
  symbol: string
  /** Bonded neighbours. */
  bonded: number
  /** Lone pairs, worked out from the valence electrons unless the structure stated them. */
  lonePairs: number
  /** Bonded atoms plus lone pairs: what VSEPR arranges. */
  domains: number
  shape: Shape
  /** The idealised angle VSEPR gives, in degrees. Null where the shape has more than one. */
  idealAngle: number | null
  /** A measured angle, where one is well known. Labelled as measured, and often different from the ideal. */
  measuredAngle: number | null
  says: string
}

/**
 * The idealised VSEPR arrangement for a count of electron domains.
 *
 * Lone pairs occupy a position and then push the bonded atoms closer together, which is why water is bent and not
 * linear. The shape named is the *molecular* shape — what the atoms look like — not the electron arrangement.
 */
function shapeFor(bonded: number, lonePairs: number): { shape: Shape; angle: number | null } {
  const domains = bonded + lonePairs
  if (bonded === 0) return { shape: 'single atom', angle: null }
  if (bonded === 1) return { shape: 'linear', angle: null }

  switch (domains) {
    case 2:
      return { shape: 'linear', angle: 180 }
    case 3:
      return lonePairs === 0 ? { shape: 'trigonal planar', angle: 120 } : { shape: 'bent', angle: 120 }
    case 4:
      if (lonePairs === 0) return { shape: 'tetrahedral', angle: 109.5 }
      if (lonePairs === 1) return { shape: 'trigonal pyramidal', angle: 107 }
      return { shape: 'bent', angle: 104.5 }
    case 5:
      if (lonePairs === 0) return { shape: 'trigonal bipyramidal', angle: null }
      if (lonePairs === 1) return { shape: 'seesaw', angle: null }
      if (lonePairs === 2) return { shape: 'T-shaped', angle: 90 }
      return { shape: 'linear', angle: 180 }
    case 6:
      if (lonePairs === 0) return { shape: 'octahedral', angle: 90 }
      if (lonePairs === 1) return { shape: 'square pyramidal', angle: 90 }
      return { shape: 'square planar', angle: 90 }
    default:
      return { shape: 'unknown', angle: null }
  }
}

/**
 * Angles that have actually been measured, for the molecules people ask about.
 *
 * Given because the idealised figure is often noticeably wrong — water's 104.5° against a tetrahedral 109.5° — and
 * showing only the ideal would teach the approximation as the fact. Keyed by the central atom's symbol and the
 * molecule's formula, because the angle is a property of the molecule and not of the element.
 */
const MEASURED: Readonly<Record<string, number>> = Object.freeze({
  'O:H2O': 104.5,
  'N:H3N': 107.8,
  'C:CH4': 109.5,
  'C:CO2': 180,
  'S:H2S': 92.1,
  'O:H2O2': 94.8,
  'C:C2H4': 121.3,
  'N:H4N': 109.5,
  'S:O2S': 119,
  'O:F2O': 103.3,
  'P:H3P': 93.5,
  'C:Cl4C': 109.5
})

/**
 * Lone pairs at an atom, from its valence electrons and the bonds it has made.
 *
 * Only meaningful for a main-group element, which is why `valenceElectrons` being null makes this return zero and
 * the report say the geometry is not predicted. Guessing a lone-pair count for a transition metal would produce a
 * confident wrong shape.
 */
function lonePairsAt(element: Element, used: number, charge: number): number | null {
  if (element.valenceElectrons === null) return null
  const electrons = element.valenceElectrons - charge
  const left = electrons - used
  if (left < 0) return 0
  return Math.floor(left / 2)
}

/** The geometry at every atom that has more than one neighbour. */
export function geometryOf(molecule: Molecule): readonly GeometryReport[] | MoleculeError {
  const formula = formulaOf(molecule)
  if (isMoleculeError(formula)) return formula

  const out: GeometryReport[] = []
  for (const atom of molecule.atoms) {
    const neighbours = molecule.bonds.filter((one) => one.from === atom.id || one.to === atom.id).length
    if (neighbours === 0) continue

    const element = elementBy(atom.symbol)
    if (isChemistryError(element)) continue

    const used = bondsAt(molecule, atom.id)
    const pairs = atom.lonePairs ?? lonePairsAt(element, used, atom.charge)

    if (pairs === null) {
      out.push({
        atomId: atom.id,
        symbol: atom.symbol,
        bonded: neighbours,
        lonePairs: 0,
        domains: neighbours,
        shape: 'unknown',
        idealAngle: null,
        measuredAngle: null,
        says: `${atom.symbol} is not a main-group element, so VSEPR does not predict its shape here.`
      })
      continue
    }

    const { shape, angle } = shapeFor(neighbours, pairs)
    const measured = MEASURED[`${atom.symbol}:${formula.formula}`] ?? null

    out.push({
      atomId: atom.id,
      symbol: atom.symbol,
      bonded: neighbours,
      lonePairs: pairs,
      domains: neighbours + pairs,
      shape,
      idealAngle: angle,
      measuredAngle: measured,
      says:
        measured !== null && angle !== null && Math.abs(measured - angle) > 0.5
          ? `${shape}. VSEPR gives ${angle}°; the measured angle is ${measured}°, because lone pairs repel more strongly than bonds.`
          : measured !== null
            ? `${shape}, ${measured}° measured.`
            : angle !== null
              ? `${shape}, about ${angle}° by VSEPR.`
              : `${shape}.`
    })
  }
  return out
}

// ---------------------------------------------------------------- polarity

export interface PolarityReport {
  /** The largest electronegativity difference across any bond. */
  largestDifference: number
  /** Every bond's character, so an individual bond can be shown. */
  bonds: readonly { bondId: string; difference: number; character: 'nonpolar' | 'polar covalent' | 'ionic' }[]
  /**
   * Whether the molecule as a whole is polar.
   *
   * Null when it cannot be decided from connectivity alone — symmetry matters, and a reliable answer needs the
   * three-dimensional arrangement. Saying null is better than guessing: CO₂ has two strongly polar bonds and no
   * dipole at all, because they cancel.
   */
  polar: boolean | null
  says: string
}

/**
 * Bond polarity, and the molecule's own where it can be decided.
 *
 * The bond figures are solid: an electronegativity difference is arithmetic on published values. The molecular
 * answer is only given for the cases symmetry settles — a single bond, or a symmetric shape whose dipoles cancel —
 * and is null otherwise rather than asserted.
 */
export function polarityOf(molecule: Molecule): PolarityReport | MoleculeError {
  if (molecule.bonds.length === 0) {
    return { largestDifference: 0, bonds: [], polar: false, says: 'A single atom has no bonds, so no dipole.' }
  }

  const bonds: { bondId: string; difference: number; character: 'nonpolar' | 'polar covalent' | 'ionic' }[] = []
  for (const bond of molecule.bonds) {
    const a = molecule.atoms.find((one) => one.id === bond.from)
    const b = molecule.atoms.find((one) => one.id === bond.to)
    if (!a || !b) return fail('broken-bond', 'A bond joins an atom that is not in the molecule.', 'Remove the bond, or add the atom.')
    const ea = elementBy(a.symbol)
    const eb = elementBy(b.symbol)
    if (isChemistryError(ea) || isChemistryError(eb)) continue
    if (ea.electronegativity === null || eb.electronegativity === null) continue

    const difference = Number(Math.abs(ea.electronegativity - eb.electronegativity).toFixed(2))
    // The usual teaching thresholds: below 0.4 nonpolar, above 1.7 predominantly ionic.
    const character = difference < 0.4 ? 'nonpolar' : difference > 1.7 ? 'ionic' : 'polar covalent'
    bonds.push({ bondId: bond.id, difference, character })
  }

  const largest = bonds.reduce((most, one) => Math.max(most, one.difference), 0)

  // Decidable only where symmetry settles it.
  let polar: boolean | null = null
  let why = 'Whether the whole molecule has a dipole depends on its shape, which connectivity alone does not settle.'

  if (molecule.atoms.length === 2) {
    polar = largest >= 0.4
    why = polar ? 'A two-atom molecule with a polar bond is polar.' : 'Two atoms of similar electronegativity: no dipole.'
  } else {
    const geometry = geometryOf(molecule)
    if (!isMoleculeError(geometry)) {
      const centre = geometry.find((one) => one.bonded >= 2)
      if (centre) {
        const symmetric = centre.lonePairs === 0 && ['linear', 'trigonal planar', 'tetrahedral', 'octahedral', 'square planar'].includes(centre.shape)
        // Symmetric and every outer atom the same: the dipoles cancel.
        const outer = molecule.bonds
          .filter((one) => one.from === centre.atomId || one.to === centre.atomId)
          .map((one) => molecule.atoms.find((two) => two.id === (one.from === centre.atomId ? one.to : one.from))?.symbol)
        const allSame = outer.length > 0 && outer.every((one) => one === outer[0])
        if (symmetric && allSame) {
          polar = false
          why = `The ${centre.shape} arrangement is symmetric and every outer atom is the same, so the bond dipoles cancel.`
        } else if (centre.lonePairs > 0 && largest >= 0.4) {
          polar = true
          why = `${centre.lonePairs === 1 ? 'A lone pair' : `${centre.lonePairs} lone pairs`} and polar bonds make the arrangement lopsided, so it has a dipole.`
        }
      }
    }
  }

  return {
    largestDifference: largest,
    bonds,
    polar,
    says: `${bonds.length > 0 ? `The most polar bond differs by ${largest} on the Pauling scale. ` : ''}${why}`
  }
}

// ---------------------------------------------------------------- building

let counter = 0
/** Ids are generated rather than positional, so a bond survives an atom being removed. */
const nextId = (prefix: string): string => `${prefix}${(counter += 1).toString(36)}`

/** Resets the id counter. For tests, so ids are predictable. */
export const resetIds = (): void => {
  counter = 0
}

export function addAtom(molecule: Molecule, symbol: string, at?: { x: number; y: number; z: number }, charge = 0): Molecule | MoleculeError {
  if (molecule.atoms.length >= MOLECULE_LIMITS.atoms) {
    return fail('too-many', `This builder holds at most ${MOLECULE_LIMITS.atoms} atoms.`, 'Remove an atom first.')
  }
  const element = elementBy(symbol)
  if (isChemistryError(element)) {
    return fail('unknown-element', `"${symbol}" is not an element Orbis knows.`, 'Symbols are case sensitive: Co is cobalt, CO is carbon monoxide.')
  }
  const atom: Atom = { id: nextId('a'), symbol: element.symbol, charge, ...(at ? { at } : {}) }
  return { ...molecule, atoms: [...molecule.atoms, atom] }
}

/**
 * An atom removed, and every bond to it with it.
 *
 * Leaving a dangling bond would be a structure that cannot be drawn or validated, so the bonds go too and the
 * caller is told how many.
 */
export function removeAtom(molecule: Molecule, atomId: string): { molecule: Molecule; removedBonds: number } | MoleculeError {
  if (!molecule.atoms.some((one) => one.id === atomId)) return fail('no-atom', 'There is no such atom.', 'Select an atom that is in the molecule.')
  const bonds = molecule.bonds.filter((one) => one.from !== atomId && one.to !== atomId)
  return {
    molecule: { ...molecule, atoms: molecule.atoms.filter((one) => one.id !== atomId), bonds },
    removedBonds: molecule.bonds.length - bonds.length
  }
}

/**
 * A bond added, or the reason it cannot be.
 *
 * Refuses a bond to itself, a duplicate, and one that would exceed what the atoms can hold — the last being the
 * check the brief asks for by name. The message says which atom is full and how many it has.
 */
export function addBond(molecule: Molecule, from: string, to: string, order: BondOrder = 1): Molecule | MoleculeError {
  if (from === to) return fail('self', 'An atom cannot bond to itself.', 'Pick two different atoms.')
  if (molecule.bonds.length >= MOLECULE_LIMITS.bonds) {
    return fail('too-many', `This builder holds at most ${MOLECULE_LIMITS.bonds} bonds.`, 'Remove a bond first.')
  }
  const a = molecule.atoms.find((one) => one.id === from)
  const b = molecule.atoms.find((one) => one.id === to)
  if (!a || !b) return fail('no-atom', 'One of those atoms is not in the molecule.', 'Add it first.')
  if (molecule.bonds.some((one) => (one.from === from && one.to === to) || (one.from === to && one.to === from))) {
    return fail('already-bonded', `${a.symbol} and ${b.symbol} are already bonded.`, 'Change the existing bond’s order instead of adding another.')
  }

  const next: Molecule = { ...molecule, bonds: [...molecule.bonds, { id: nextId('b'), from, to, order }] }

  // Checked after adding and refused rather than accepted-with-a-warning: this is the "why is this invalid" case.
  const report = checkValence(next)
  const broken = report.atoms.find((one) => one.verdict === 'wrong' && (one.atomId === from || one.atomId === to))
  if (broken) {
    const which = broken.atomId === from ? a : b
    return fail(
      'valence',
      `${which.symbol} cannot take another bond: ${broken.says}`,
      which.symbol === 'H'
        ? 'Hydrogen makes one bond only. Bond to a different atom.'
        : `Remove one of ${which.symbol}’s existing bonds first, or bond to an atom that has room.`
    )
  }
  return next
}

export function setBondOrder(molecule: Molecule, bondId: string, order: BondOrder): Molecule | MoleculeError {
  const bond = molecule.bonds.find((one) => one.id === bondId)
  if (!bond) return fail('no-bond', 'There is no such bond.', 'Select a bond that is in the molecule.')
  const next: Molecule = { ...molecule, bonds: molecule.bonds.map((one) => (one.id === bondId ? { ...one, order } : one)) }
  const report = checkValence(next)
  const broken = report.atoms.find((one) => one.verdict === 'wrong' && (one.atomId === bond.from || one.atomId === bond.to))
  if (broken) {
    return fail('valence', `That bond order does not work: ${broken.says}`, 'Use a lower order, or remove another bond from that atom first.')
  }
  return next
}

export function removeBond(molecule: Molecule, bondId: string): Molecule | MoleculeError {
  if (!molecule.bonds.some((one) => one.id === bondId)) return fail('no-bond', 'There is no such bond.', 'Select a bond that is in the molecule.')
  return { ...molecule, bonds: molecule.bonds.filter((one) => one.id !== bondId) }
}

// ---------------------------------------------------------------- structure

export interface StructureReport {
  /** How many separate pieces the molecule is in. More than one means it is not a single molecule. */
  pieces: number
  /** Rings found, each as the atom ids going round. */
  rings: readonly (readonly string[])[]
  /** Atoms bonded to nothing. */
  loose: readonly string[]
  says: string
}

/** Connectivity: how many pieces, which rings, what is loose. */
export function structureOf(molecule: Molecule): StructureReport {
  const near = new Map<string, string[]>()
  for (const atom of molecule.atoms) near.set(atom.id, [])
  for (const bond of molecule.bonds) {
    near.get(bond.from)?.push(bond.to)
    near.get(bond.to)?.push(bond.from)
  }

  const seen = new Set<string>()
  let pieces = 0
  for (const atom of molecule.atoms) {
    if (seen.has(atom.id)) continue
    pieces += 1
    const queue = [atom.id]
    seen.add(atom.id)
    while (queue.length > 0) {
      const at = queue.shift() as string
      for (const to of near.get(at) ?? []) {
        if (!seen.has(to)) {
          seen.add(to)
          queue.push(to)
        }
      }
    }
  }

  /*
   * Rings, by depth-first search with a parent to avoid walking straight back.
   *
   * Finds the rings present rather than a minimal basis — benzene reports one ring, and a fused system reports each
   * cycle it walks. Enough to say "this is cyclic" and to draw it, which is what the laboratory needs.
   */
  const rings: string[][] = []
  const visited = new Set<string>()
  const walk = (at: string, from: string | null, path: string[]): void => {
    if (rings.length >= 20 || path.length > MOLECULE_LIMITS.ringSize) return
    visited.add(at)
    path.push(at)
    for (const to of near.get(at) ?? []) {
      if (to === from) continue
      const already = path.indexOf(to)
      if (already >= 0) {
        const ring = path.slice(already)
        // Each ring is recorded once, by comparing sorted members.
        const key = [...ring].sort().join(',')
        if (ring.length >= 3 && !rings.some((one) => [...one].sort().join(',') === key)) rings.push(ring)
        continue
      }
      if (!visited.has(to)) walk(to, at, path)
    }
    path.pop()
  }
  for (const atom of molecule.atoms) if (!visited.has(atom.id)) walk(atom.id, null, [])

  const loose = molecule.atoms.filter((one) => (near.get(one.id) ?? []).length === 0).map((one) => one.id)

  const parts: string[] = []
  if (pieces > 1) parts.push(`This is ${pieces} separate pieces, not one molecule.`)
  if (rings.length > 0) parts.push(`${rings.length} ring${rings.length === 1 ? '' : 's'}, the smallest of ${Math.min(...rings.map((one) => one.length))} atoms.`)
  if (loose.length > 0) parts.push(`${loose.length} atom${loose.length === 1 ? ' is' : 's are'} bonded to nothing.`)

  return { pieces, rings, loose, says: parts.length > 0 ? parts.join(' ') : 'One connected molecule, with no rings.' }
}

// ---------------------------------------------------------------- coordinates

/**
 * Three-dimensional positions, laid out from the VSEPR shapes.
 *
 * ## What this is, and what it is not
 *
 * It places each atom at the idealised VSEPR direction from the atom it is bonded to, at a bond length taken from
 * covalent radii. That gives a recognisable, rotatable molecule: water bent at about 104°, methane tetrahedral,
 * carbon dioxide straight.
 *
 * It is **not** geometry optimisation. There is no force field and no energy minimisation, so a large or strained
 * molecule will look approximate and a ring will be laid out flat. The laboratory says so rather than implying the
 * shape is calculated — §117 of the brief, and the difference between a visualisation and a measurement.
 */
const COVALENT_RADIUS: Readonly<Record<string, number>> = Object.freeze({
  H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
  Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76,
  Br: 1.2, I: 1.39, Ag: 1.45, Pt: 1.36, Au: 1.36, Hg: 1.32, Pb: 1.46, Ba: 2.15, U: 1.96,
  Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22
})

/** Bond length as the sum of covalent radii, shortened for a double or triple bond as they really are. */
export function bondLength(a: string, b: string, order: BondOrder = 1): number {
  const ra = COVALENT_RADIUS[a] ?? 1.2
  const rb = COVALENT_RADIUS[b] ?? 1.2
  const shrink = order === 3 ? 0.78 : order === 2 ? 0.87 : 1
  return Number(((ra + rb) * shrink).toFixed(3))
}

/** Unit directions for a count of electron domains, in the idealised VSEPR arrangement. */
function directionsFor(domains: number): readonly { x: number; y: number; z: number }[] {
  const t = 1 / Math.sqrt(3)
  switch (domains) {
    case 1:
      return [{ x: 1, y: 0, z: 0 }]
    case 2:
      return [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 }
      ]
    case 3:
      return [
        { x: 1, y: 0, z: 0 },
        { x: -0.5, y: 0.866, z: 0 },
        { x: -0.5, y: -0.866, z: 0 }
      ]
    case 4:
      // The tetrahedron's corners, which give the 109.47° angle exactly.
      return [
        { x: t, y: t, z: t },
        { x: t, y: -t, z: -t },
        { x: -t, y: t, z: -t },
        { x: -t, y: -t, z: t }
      ]
    case 5:
      return [
        { x: 1, y: 0, z: 0 },
        { x: -0.5, y: 0.866, z: 0 },
        { x: -0.5, y: -0.866, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
      ]
    default:
      return [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
      ]
  }
}

export interface LaidOut {
  molecule: Molecule
  /** Said on screen, so nobody reads the picture as a measurement. */
  note: string
  /** True when a ring was laid out flat and is therefore approximate. */
  approximate: boolean
}

/**
 * Positions for every atom.
 *
 * Breadth-first from the most-bonded atom, placing each neighbour along a free VSEPR direction rotated into the
 * frame of the bond that led there. Deterministic, so the same molecule always looks the same.
 */
export function layOut(molecule: Molecule): LaidOut | MoleculeError {
  if (molecule.atoms.length === 0) return fail('empty', 'There are no atoms to place.', 'Add an atom.')

  const geometry = geometryOf(molecule)
  if (isMoleculeError(geometry)) return geometry
  const domainsAt = new Map(geometry.map((one) => [one.atomId, one.domains]))

  const near = new Map<string, { to: string; order: BondOrder }[]>()
  for (const atom of molecule.atoms) near.set(atom.id, [])
  for (const bond of molecule.bonds) {
    near.get(bond.from)?.push({ to: bond.to, order: bond.order })
    near.get(bond.to)?.push({ to: bond.from, order: bond.order })
  }

  // Start from the most connected atom, so the central atom sits at the origin and the picture is centred.
  const start = [...molecule.atoms].sort((a, b) => (near.get(b.id)?.length ?? 0) - (near.get(a.id)?.length ?? 0))[0]
  const at = new Map<string, { x: number; y: number; z: number }>([[start.id, { x: 0, y: 0, z: 0 }]])
  const used = new Map<string, number>()

  const queue: string[] = [start.id]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const here = at.get(id) as { x: number; y: number; z: number }
    const atom = molecule.atoms.find((one) => one.id === id)
    if (!atom) continue
    const domains = Math.max(domainsAt.get(id) ?? (near.get(id)?.length ?? 1), near.get(id)?.length ?? 1)
    const directions = directionsFor(Math.min(6, Math.max(1, domains)))

    for (const edge of near.get(id) ?? []) {
      if (at.has(edge.to)) continue
      const other = molecule.atoms.find((one) => one.id === edge.to)
      if (!other) continue
      const slot = used.get(id) ?? 0
      used.set(id, slot + 1)
      const direction = directions[Math.min(slot, directions.length - 1)]
      const length = bondLength(atom.symbol, other.symbol, edge.order)
      at.set(edge.to, {
        x: Number((here.x + direction.x * length).toFixed(4)),
        y: Number((here.y + direction.y * length).toFixed(4)),
        z: Number((here.z + direction.z * length).toFixed(4))
      })
      queue.push(edge.to)
    }
  }

  // Anything in a separate piece gets placed to one side rather than stacked at the origin.
  let aside = 0
  for (const atom of molecule.atoms) {
    if (at.has(atom.id)) continue
    aside += 1
    at.set(atom.id, { x: 0, y: -3 * aside, z: 0 })
  }

  const structure = structureOf(molecule)
  const approximate = structure.rings.length > 0 || molecule.atoms.length > 12

  return {
    molecule: { ...molecule, atoms: molecule.atoms.map((one) => ({ ...one, at: at.get(one.id) })) },
    note: approximate
      ? 'The positions come from idealised VSEPR directions, not from energy minimisation, so rings are laid out flat and a large molecule will look approximate.'
      : 'The positions come from idealised VSEPR directions and covalent radii. They are a visualisation, not a measured structure.',
    approximate
  }
}

/** The angle at `centre` between two bonded atoms, from the laid-out positions. Degrees. */
export function angleAt(molecule: Molecule, centre: string, a: string, b: string): number | MoleculeError {
  const atoms = new Map(molecule.atoms.map((one) => [one.id, one]))
  const c = atoms.get(centre)?.at
  const p = atoms.get(a)?.at
  const q = atoms.get(b)?.at
  if (!c || !p || !q) return fail('no-positions', 'Those atoms have no positions yet.', 'Lay the molecule out first.')

  const u = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }
  const v = { x: q.x - c.x, y: q.y - c.y, z: q.z - c.z }
  const dot = u.x * v.x + u.y * v.y + u.z * v.z
  const mu = Math.hypot(u.x, u.y, u.z)
  const mv = Math.hypot(v.x, v.y, v.z)
  if (mu === 0 || mv === 0) return fail('degenerate', 'Two of those atoms are in the same place.', 'Lay the molecule out again.')
  const cos = Math.min(1, Math.max(-1, dot / (mu * mv)))
  return Number(((Math.acos(cos) * 180) / Math.PI).toFixed(2))
}

// ---------------------------------------------------------------- known molecules

/**
 * Molecules to start from, built as real structures rather than drawn.
 *
 * Every one of these goes through `addAtom` and `addBond`, so each is valence-checked on construction: if one of
 * them were wrong, the test suite would say so rather than the picture looking fine.
 */
export const KNOWN: readonly { id: string; name: string; build: () => Molecule | MoleculeError }[] = Object.freeze([
  { id: 'water', name: 'Water', build: () => chain([['O', 'H'], ['O', 'H']], 'Water') },
  { id: 'methane', name: 'Methane', build: () => star('C', ['H', 'H', 'H', 'H'], 'Methane') },
  { id: 'ammonia', name: 'Ammonia', build: () => star('N', ['H', 'H', 'H'], 'Ammonia') },
  { id: 'carbon-dioxide', name: 'Carbon dioxide', build: () => star('C', ['O', 'O'], 'Carbon dioxide', 2) },
  { id: 'oxygen', name: 'Oxygen', build: () => pair('O', 'O', 2, 'Oxygen') },
  { id: 'nitrogen', name: 'Nitrogen', build: () => pair('N', 'N', 3, 'Nitrogen') },
  { id: 'hydrogen-chloride', name: 'Hydrogen chloride', build: () => pair('H', 'Cl', 1, 'Hydrogen chloride') },
  { id: 'ethene', name: 'Ethene', build: () => ethene() },
  { id: 'ethanol', name: 'Ethanol', build: () => ethanol() },
  { id: 'benzene', name: 'Benzene', build: () => benzene() },
  { id: 'sulphur-hexafluoride', name: 'Sulphur hexafluoride', build: () => star('S', ['F', 'F', 'F', 'F', 'F', 'F'], 'Sulphur hexafluoride') },
  { id: 'methanol', name: 'Methanol', build: () => methanol() },
  { id: 'hydrogen-peroxide', name: 'Hydrogen peroxide', build: () => peroxide() },
  { id: 'sulphur-dioxide', name: 'Sulphur dioxide', build: () => star('S', ['O', 'O'], 'Sulphur dioxide', 2) }
])

function pair(a: string, b: string, order: BondOrder, name: string): Molecule | MoleculeError {
  let made = addAtom({ ...EMPTY_MOLECULE, name }, a)
  if (isMoleculeError(made)) return made
  const first = made.atoms[0].id
  made = addAtom(made, b)
  if (isMoleculeError(made)) return made
  const second = made.atoms[1].id
  return addBond(made, first, second, order)
}

/** A central atom with outer atoms bonded to it. */
function star(centre: string, outer: readonly string[], name: string, order: BondOrder = 1): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = addAtom({ ...EMPTY_MOLECULE, name }, centre)
  if (isMoleculeError(made)) return made
  const middle = made.atoms[0].id
  for (const symbol of outer) {
    const added = addAtom(made as Molecule, symbol)
    if (isMoleculeError(added)) return added
    const id = added.atoms[added.atoms.length - 1].id
    made = addBond(added, middle, id, order)
    if (isMoleculeError(made)) return made
  }
  return made
}

/** A run of bonds given as symbol pairs, reusing the first symbol's atom. */
function chain(pairs: readonly (readonly [string, string])[], name: string): Molecule | MoleculeError {
  if (pairs.length === 0) return fail('empty', 'Nothing to build.', 'Give at least one bond.')
  let made: Molecule | MoleculeError = addAtom({ ...EMPTY_MOLECULE, name }, pairs[0][0])
  if (isMoleculeError(made)) return made
  const centre = made.atoms[0].id
  for (const [, to] of pairs) {
    const added = addAtom(made as Molecule, to)
    if (isMoleculeError(added)) return added
    made = addBond(added, centre, added.atoms[added.atoms.length - 1].id, 1)
    if (isMoleculeError(made)) return made
  }
  return made
}

function ethene(): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = { ...EMPTY_MOLECULE, name: 'Ethene' }
  const ids: string[] = []
  for (const symbol of ['C', 'C', 'H', 'H', 'H', 'H']) {
    const added = addAtom(made as Molecule, symbol)
    if (isMoleculeError(added)) return added
    made = added
    ids.push(added.atoms[added.atoms.length - 1].id)
  }
  const joins: readonly (readonly [number, number, BondOrder])[] = [
    [0, 1, 2],
    [0, 2, 1],
    [0, 3, 1],
    [1, 4, 1],
    [1, 5, 1]
  ]
  for (const [a, b, order] of joins) {
    made = addBond(made as Molecule, ids[a], ids[b], order)
    if (isMoleculeError(made)) return made
  }
  return made
}

function ethanol(): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = { ...EMPTY_MOLECULE, name: 'Ethanol' }
  const ids: string[] = []
  // C, C, O, then six hydrogens: CH3-CH2-OH
  for (const symbol of ['C', 'C', 'O', 'H', 'H', 'H', 'H', 'H', 'H']) {
    const added = addAtom(made as Molecule, symbol)
    if (isMoleculeError(added)) return added
    made = added
    ids.push(added.atoms[added.atoms.length - 1].id)
  }
  const joins: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [1, 6],
    [1, 7],
    [2, 8]
  ]
  for (const [a, b] of joins) {
    made = addBond(made as Molecule, ids[a], ids[b], 1)
    if (isMoleculeError(made)) return made
  }
  return made
}

function methanol(): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = { ...EMPTY_MOLECULE, name: 'Methanol' }
  const ids: string[] = []
  for (const symbol of ['C', 'O', 'H', 'H', 'H', 'H']) {
    const added = addAtom(made as Molecule, symbol)
    if (isMoleculeError(added)) return added
    made = added
    ids.push(added.atoms[added.atoms.length - 1].id)
  }
  for (const [a, b] of [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5]] as const) {
    made = addBond(made as Molecule, ids[a], ids[b], 1)
    if (isMoleculeError(made)) return made
  }
  return made
}

function peroxide(): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = { ...EMPTY_MOLECULE, name: 'Hydrogen peroxide' }
  const ids: string[] = []
  for (const symbol of ['O', 'O', 'H', 'H']) {
    const added = addAtom(made as Molecule, symbol)
    if (isMoleculeError(added)) return added
    made = added
    ids.push(added.atoms[added.atoms.length - 1].id)
  }
  for (const [a, b] of [[0, 1], [0, 2], [1, 3]] as const) {
    made = addBond(made as Molecule, ids[a], ids[b], 1)
    if (isMoleculeError(made)) return made
  }
  return made
}

/**
 * Benzene, as a Kekulé structure with alternating bonds.
 *
 * Drawn alternating because that is a structure the valence rules accept and that can be laid out. The real
 * molecule is delocalised — every carbon-carbon bond is the same length, between a single and a double — and the
 * `aromatic` flag records that so nothing presents the alternation as the truth.
 */
function benzene(): Molecule | MoleculeError {
  let made: Molecule | MoleculeError = { ...EMPTY_MOLECULE, name: 'Benzene' }
  const carbons: string[] = []
  for (let one = 0; one < 6; one += 1) {
    const added = addAtom(made as Molecule, 'C')
    if (isMoleculeError(added)) return added
    made = added
    carbons.push(added.atoms[added.atoms.length - 1].id)
  }
  for (let one = 0; one < 6; one += 1) {
    const order: BondOrder = one % 2 === 0 ? 2 : 1
    made = addBond(made as Molecule, carbons[one], carbons[(one + 1) % 6], order)
    if (isMoleculeError(made)) return made
    const current = made as Molecule
    made = { ...current, bonds: current.bonds.map((two, index) => (index === current.bonds.length - 1 ? { ...two, aromatic: true } : two)) }
  }
  for (const carbon of carbons) {
    const added = addAtom(made as Molecule, 'H')
    if (isMoleculeError(added)) return added
    made = addBond(added, carbon, added.atoms[added.atoms.length - 1].id, 1)
    if (isMoleculeError(made)) return made
  }
  return made
}

/** One of the known molecules by id. */
export function knownMolecule(id: string): Molecule | MoleculeError {
  const found = KNOWN.find((one) => one.id === id)
  if (!found) return fail('unknown', `There is no molecule called "${id}".`, `Try one of: ${KNOWN.slice(0, 6).map((one) => one.id).join(', ')}.`)
  return found.build()
}

// ---------------------------------------------------------------- the whole report

export interface MoleculeReport {
  formula: FormulaReport
  valence: ValenceReport
  geometry: readonly GeometryReport[]
  polarity: PolarityReport
  structure: StructureReport
  /** The note about what the positions are and are not. */
  note: string
  approximate: boolean
}

/** Everything about a molecule, in one call. What the laboratory shows and what Orion is given. */
export function describeMolecule(molecule: Molecule): MoleculeReport | MoleculeError {
  const formula = formulaOf(molecule)
  if (isMoleculeError(formula)) return formula
  const geometry = geometryOf(molecule)
  if (isMoleculeError(geometry)) return geometry
  const polarity = polarityOf(molecule)
  if (isMoleculeError(polarity)) return polarity
  const laid = layOut(molecule)
  if (isMoleculeError(laid)) return laid

  return {
    formula,
    valence: checkValence(molecule),
    geometry,
    polarity,
    structure: structureOf(molecule),
    note: laid.note,
    approximate: laid.approximate
  }
}
