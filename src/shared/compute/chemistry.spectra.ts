import { ALL_ELEMENTS } from './chemistry.table.ts'
import { isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'

/**
 * Spectroscopy and quantum chemistry: what an instrument would show, and why.
 *
 * ## The mass spectrum is computed from real isotope abundances
 *
 * The chlorine pattern — a peak and another two mass units up at a third the height — is not a special case
 * written in. It falls out of expanding the isotope distribution of every atom in the formula, so bromine gives
 * its near-equal pair and sulphur its small M+2 without anything being told about them. That is the difference
 * between a spectrum and a picture of one.
 *
 * ## Hückel theory is a real eigenvalue problem
 *
 * The π energies of benzene are not stored. The connection matrix is built from the ring and diagonalised, so
 * benzene comes out with its famous α+2β and the degenerate pairs, and butadiene comes out different because the
 * matrix is different. Change the ring size and the answer changes correctly.
 *
 * ## What it refuses
 *
 * An IR or NMR prediction is rule-based and says so loudly. These are the tables a chemist uses to read a
 * spectrum, applied in reverse — they are not a calculation from first principles and must never be presented as
 * one. Every prediction carries its range rather than a single number, because that is what the table gives.
 *
 * Pure. No clock, no randomness.
 */

const fail = (error: ChemistryError['error'], message: string, fix: string): ChemistryError => ({
  error,
  message: `${message} ${fix}`
})

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// ——— Isotopes, for the mass spectrum ——————————————————————————————————————

/** The isotopes that actually matter for a mass spectrum, with their real abundances. */
const ISOTOPES: Record<string, readonly { mass: number; abundance: number }[]> = {
  H: [{ mass: 1.0078250319, abundance: 0.999885 }, { mass: 2.0141017778, abundance: 0.000115 }],
  C: [{ mass: 12, abundance: 0.9893 }, { mass: 13.0033548378, abundance: 0.0107 }],
  N: [{ mass: 14.0030740052, abundance: 0.99632 }, { mass: 15.0001088984, abundance: 0.00368 }],
  O: [{ mass: 15.9949146221, abundance: 0.99757 }, { mass: 16.9991315, abundance: 0.00038 }, { mass: 17.9991604, abundance: 0.00205 }],
  F: [{ mass: 18.99840322, abundance: 1 }],
  Si: [{ mass: 27.9769265327, abundance: 0.922297 }, { mass: 28.97649472, abundance: 0.046832 }, { mass: 29.97377022, abundance: 0.030872 }],
  P: [{ mass: 30.97376151, abundance: 1 }],
  S: [{ mass: 31.97207069, abundance: 0.9493 }, { mass: 32.9714585, abundance: 0.0076 }, { mass: 33.96786683, abundance: 0.0429 }, { mass: 35.96708088, abundance: 0.0002 }],
  // Chlorine's 3:1 pair and bromine's near-equal one are the two patterns every chemist recognises on sight.
  Cl: [{ mass: 34.96885271, abundance: 0.7578 }, { mass: 36.9659026, abundance: 0.2422 }],
  Br: [{ mass: 78.9183376, abundance: 0.5069 }, { mass: 80.916291, abundance: 0.4931 }],
  I: [{ mass: 126.904468, abundance: 1 }],
  B: [{ mass: 10.0129370, abundance: 0.199 }, { mass: 11.0093055, abundance: 0.801 }],
  Na: [{ mass: 22.98976928, abundance: 1 }],
  K: [{ mass: 38.9637069, abundance: 0.932581 }, { mass: 39.96399867, abundance: 0.000117 }, { mass: 40.96182597, abundance: 0.067302 }]
}

export interface MassPeak {
  /** Mass over charge, which for a singly charged ion is the mass. */
  mz: number
  /** Height against the tallest peak, as a percentage. */
  relative: number
  /** How many mass units above the lightest peak. M, M+1, M+2 and so on. */
  offset: number
}

export interface MassReport {
  formula: string
  /** The mass using the commonest isotope of each element — what a high-resolution instrument measures. */
  monoisotopicMass: number
  /** The mass using the average of each element's isotopes — what a balance measures. */
  averageMass: number
  peaks: readonly MassPeak[]
  /** Set when the pattern itself gives the element away. */
  tells: readonly string[]
  /** How many rings plus double bonds the formula must contain. A whole number, or the formula is impossible. */
  degreeOfUnsaturation: number | null
  assumptions: readonly string[]
}

/**
 * The isotope pattern of a formula, expanded properly.
 *
 * Each element contributes a distribution; the whole molecule's is their convolution. Doing it this way is what
 * makes chlorine's 3:1 pair and bromine's 1:1 pair appear without either being special-cased.
 */
export function massSpectrum(formula: string, cutoff = 0.1): MassReport | ChemistryError {
  const parsed = parseFormula(formula)
  if (isChemistryError(parsed)) return parsed
  if (!finite(cutoff) || cutoff < 0 || cutoff >= 100) {
    return fail('invalid-argument', `A cutoff of ${cutoff}% makes no sense.`, 'Give a percentage between 0 and 100 — peaks below it are left out.')
  }

  // Start with a single peak of mass zero and probability one, then fold in every atom.
  let distribution = new Map<number, { mass: number; probability: number }>([[0, { mass: 0, probability: 1 }]])
  let monoisotopic = 0
  const missing: string[] = []

  for (const part of parsed.composition) {
    const isotopes = ISOTOPES[part.symbol]
    if (!isotopes) {
      missing.push(part.symbol)
      continue
    }
    monoisotopic += [...isotopes].sort((a, b) => b.abundance - a.abundance)[0].mass * part.count
    for (let one = 0; one < part.count; one += 1) {
      const next = new Map<number, { mass: number; probability: number }>()
      for (const [, held] of distribution) {
        for (const isotope of isotopes) {
          const mass = held.mass + isotope.mass
          const probability = held.probability * isotope.abundance
          if (probability < 1e-9) continue
          // Group by nominal mass: a mass spectrometer of ordinary resolution cannot separate within one unit.
          const key = Math.round(mass)
          const already = next.get(key)
          if (already) {
            // Weighted mean, so the reported mass of a merged peak is where it really sits.
            const total = already.probability + probability
            already.mass = (already.mass * already.probability + mass * probability) / total
            already.probability = total
          } else {
            next.set(key, { mass, probability })
          }
        }
      }
      distribution = next
      if (distribution.size > 400) {
        return fail('too-many', `${formula} has too many isotope combinations to expand.`, 'Try a smaller formula — this handles molecules up to a few hundred atoms of the common elements.')
      }
    }
  }

  if (missing.length > 0) {
    return fail(
      'no-data',
      `No isotope data here for ${missing.join(', ')}.`,
      `This has ${Object.keys(ISOTOPES).join(', ')} — the elements that actually appear in organic mass spectrometry. Rather than guess at the rest, it refuses.`
    )
  }

  const sorted = [...distribution.values()].sort((a, b) => a.mass - b.mass)
  const tallest = Math.max(...sorted.map((one) => one.probability))
  const lightest = Math.round(sorted[0].mass)
  const peaks = sorted
    .map((one) => ({ mz: one.mass, relative: (one.probability / tallest) * 100, offset: Math.round(one.mass) - lightest }))
    .filter((one) => one.relative >= cutoff)

  // What a chemist reads off the pattern at a glance.
  const tells: string[] = []
  const plusTwo = peaks.find((one) => one.offset === 2)
  if (plusTwo) {
    if (plusTwo.relative > 90) tells.push('The M and M+2 peaks are nearly equal, which means one bromine.')
    else if (plusTwo.relative > 28 && plusTwo.relative < 38) tells.push('M+2 is about a third of M, which means one chlorine.')
    else if (plusTwo.relative > 60 && plusTwo.relative < 70) tells.push('M+2 is about two thirds of M, which means two chlorines.')
    else if (plusTwo.relative > 3 && plusTwo.relative < 6) tells.push('A small M+2 of about 4% suggests one sulphur.')
  }
  const carbons = parsed.composition.find((one) => one.symbol === 'C')?.count ?? 0
  const nitrogens = parsed.composition.find((one) => one.symbol === 'N')?.count ?? 0
  const plusOne = peaks.find((one) => one.offset === 1)
  if (carbons > 0 && plusOne) {
    // The rule of thumb is 1.1% per carbon — but nitrogen-15 adds about 0.37% per nitrogen, so in anything with
    // nitrogen the raw count comes out too high. Saying so beats quietly reporting the wrong number of carbons.
    const raw = plusOne.relative / 1.1
    const corrected = (plusOne.relative - nitrogens * 0.37) / 1.1
    tells.push(
      nitrogens > 0
        ? `M+1 is ${plusOne.relative.toFixed(1)}% of M. The usual 1.1%-per-carbon rule would say ${Math.round(raw)} carbons, but nitrogen-15 adds about 0.37% each — taking off ${nitrogens} nitrogen${nitrogens === 1 ? '' : 's'} gives ${Math.round(corrected)}.`
        : `M+1 is ${plusOne.relative.toFixed(1)}% of M; carbon-13 contributes roughly 1.1% per carbon, so about ${Math.round(raw)} carbon${Math.round(raw) === 1 ? '' : 's'}.`
    )
  }
  if (Math.round(sorted[0].mass) % 2 === 1 && (parsed.composition.find((one) => one.symbol === 'N')?.count ?? 0) === 0) {
    tells.push('An odd molecular mass with no nitrogen is unusual — check the formula. The nitrogen rule says an odd mass means an odd number of nitrogens.')
  }

  // Rings plus double bonds, from the formula alone. A half means the formula cannot exist.
  let unsaturation: number | null = null
  const count = (symbol: string): number => parsed.composition.find((one) => one.symbol === symbol)?.count ?? 0
  const c = count('C')
  if (c > 0) {
    const h = count('H')
    const n = count('N')
    const halogens = count('F') + count('Cl') + count('Br') + count('I')
    unsaturation = c - (h + halogens) / 2 + n / 2 + 1
  }

  return {
    formula: parsed.formula,
    monoisotopicMass: monoisotopic,
    averageMass: parsed.molarMass,
    peaks,
    tells,
    degreeOfUnsaturation: unsaturation,
    assumptions: [
      'Singly charged ions only, so m/z is the mass. A doubly charged ion appears at half this and is not shown.',
      'Peaks are grouped to the nearest whole mass, which is what an ordinary instrument resolves. A high-resolution one would separate several of these.',
      'The molecular ion only. Real spectra are dominated by fragments, and nothing here fragments anything.',
      'Isotope abundances are the standard terrestrial ones. A sample from elsewhere, or an enriched one, would differ.'
    ]
  }
}

// ——— Infrared ——————————————————————————————————————————————————————————————

export interface Absorption {
  group: string
  /** Where it appears, as a range — because that is what the table gives. */
  from: number
  to: number
  strength: 'strong' | 'medium' | 'weak'
  shape: string
  note: string
}

/**
 * Infrared absorptions, by functional group.
 *
 * These are the tables a chemist reads a spectrum with. They are empirical ranges, not calculated frequencies,
 * and every entry carries a range rather than a number for exactly that reason.
 */
export const IR_TABLE: readonly Absorption[] = Object.freeze([
  { group: 'O-H (alcohol)', from: 3200, to: 3600, strength: 'strong', shape: 'broad', note: 'The breadth is hydrogen bonding. A dilute sample sharpens it up towards 3600.' },
  { group: 'O-H (carboxylic acid)', from: 2500, to: 3300, strength: 'strong', shape: 'very broad', note: 'Unmistakable: it sprawls across the C-H region and swallows it.' },
  { group: 'N-H (amine)', from: 3300, to: 3500, strength: 'medium', shape: 'sharp', note: 'A primary amine gives two peaks, a secondary one, a tertiary none at all.' },
  { group: 'C-H (alkane)', from: 2850, to: 2960, strength: 'medium', shape: 'sharp', note: 'Almost everything organic has this, so it says very little on its own.' },
  { group: 'C-H (alkene)', from: 3020, to: 3100, strength: 'medium', shape: 'sharp', note: 'Just above 3000 — the side of 3000 a C-H peak falls on is worth checking every time.' },
  { group: 'C-H (aldehyde)', from: 2700, to: 2800, strength: 'medium', shape: 'two peaks', note: 'A pair below the usual C-H, and together with a carbonyl it settles an aldehyde.' },
  { group: 'C≡N (nitrile)', from: 2220, to: 2260, strength: 'medium', shape: 'sharp', note: 'In an otherwise empty region, which makes it easy.' },
  { group: 'C≡C (alkyne)', from: 2100, to: 2260, strength: 'weak', shape: 'sharp', note: 'Weak, and absent entirely if the triple bond sits symmetrically.' },
  { group: 'C=O (aldehyde)', from: 1720, to: 1740, strength: 'strong', shape: 'sharp', note: 'The carbonyl region is where most structures are settled.' },
  { group: 'C=O (ketone)', from: 1705, to: 1725, strength: 'strong', shape: 'sharp', note: 'A few wavenumbers below an aldehyde, which is not enough to tell them apart alone.' },
  { group: 'C=O (ester)', from: 1735, to: 1750, strength: 'strong', shape: 'sharp', note: 'Higher than a ketone, and with strong C-O bands near 1200 to confirm it.' },
  { group: 'C=O (carboxylic acid)', from: 1700, to: 1725, strength: 'strong', shape: 'sharp', note: 'Together with the enormous O-H, this is conclusive.' },
  { group: 'C=O (amide)', from: 1630, to: 1690, strength: 'strong', shape: 'sharp', note: 'The lowest carbonyl of the common ones, because the nitrogen donates into it.' },
  { group: 'C=C (alkene)', from: 1620, to: 1680, strength: 'medium', shape: 'sharp', note: 'Weak or missing when the double bond is symmetrical.' },
  { group: 'C=C (aromatic)', from: 1450, to: 1600, strength: 'medium', shape: 'several', note: 'Usually two to four bands, which is itself the giveaway.' },
  { group: 'C-O', from: 1000, to: 1300, strength: 'strong', shape: 'sharp', note: 'Alcohols, ethers and esters all have one, so it narrows rather than decides.' },
  { group: 'C-N', from: 1020, to: 1250, strength: 'medium', shape: 'sharp', note: 'Overlaps C-O badly, which is why it is rarely decisive.' },
  { group: 'N-O (nitro)', from: 1500, to: 1560, strength: 'strong', shape: 'two peaks', note: 'A pair, with the other near 1350.' }
])

export interface IrReport {
  expected: readonly Absorption[]
  /** The region below 1500 that is unique to a compound and not worth assigning peak by peak. */
  fingerprintNote: string
  assumptions: readonly string[]
}

/** The absorptions to expect from a list of functional groups. */
export function infrared(groups: readonly string[]): IrReport | ChemistryError {
  if (!Array.isArray(groups) || groups.length === 0) {
    return fail('no-data', 'No functional groups were given.', `Name some of: ${[...new Set(IR_TABLE.map((one) => one.group.split(' ')[0]))].join(', ')}.`)
  }
  const wanted = groups.map((one) => String(one).toLowerCase().trim())
  const expected = IR_TABLE.filter((one) => wanted.some((two) => one.group.toLowerCase().includes(two)))
  if (expected.length === 0) {
    return fail(
      'no-data',
      `Nothing in the table matches ${groups.join(', ')}.`,
      `It holds: ${IR_TABLE.map((one) => one.group).join('; ')}.`
    )
  }
  return {
    expected: [...expected].sort((a, b) => b.from - a.from),
    fingerprintNote:
      'Below about 1500 cm⁻¹ is the fingerprint region. It is unique to a compound and is used for matching against a known sample, not for assigning peak by peak — attempting that is where most wrong structures come from.',
    assumptions: [
      'These are empirical ranges from the standard tables, not calculated frequencies. They are what a chemist reads a spectrum with.',
      'Conjugation lowers a carbonyl by roughly 20 to 30 cm⁻¹, and a small ring raises it. Neither is applied here.',
      'The spectrum of a real sample depends on whether it is solid, liquid or in solution, and hydrogen bonding moves O-H and N-H substantially.',
      'An absent peak is weaker evidence than a present one: a symmetrical bond can be infrared-silent entirely.'
    ]
  }
}

// ——— Hückel molecular orbitals ————————————————————————————————————————————

export interface HuckelReport {
  /** What was built. */
  shape: string
  atoms: number
  /** Energies in units of β above α. Benzene gives 2, 1, 1, −1, −1, −2. */
  energies: readonly number[]
  /** How many electrons in each level. */
  occupancy: readonly number[]
  /** Total π energy, in β. */
  totalEnergy: number
  /** Against the same number of isolated double bonds — this is what aromatic stabilisation means. */
  delocalisationEnergy: number
  /** Highest occupied and lowest empty, and the gap between them. */
  homo: number
  lumo: number
  gap: number
  /** Hückel's 4n+2 rule, checked rather than quoted. */
  aromatic: { is: boolean; why: string }
  assumptions: readonly string[]
}

/** Eigenvalues of a small symmetric matrix, by the Jacobi rotation method. Exact to machine precision. */
function eigenvalues(matrix: number[][]): number[] {
  const n = matrix.length
  const a = matrix.map((row) => [...row])
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q]
    if (off < 1e-24) break
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-18) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let one = 0; one < n; one += 1) {
          const ap = a[one][p]
          const aq = a[one][q]
          a[one][p] = c * ap - s * aq
          a[one][q] = s * ap + c * aq
        }
        for (let one = 0; one < n; one += 1) {
          const ap = a[p][one]
          const aq = a[q][one]
          a[p][one] = c * ap - s * aq
          a[q][one] = s * ap + c * aq
        }
      }
    }
  }
  return a.map((row, one) => row[one]).sort((x, y) => y - x)
}

/**
 * Hückel theory for a ring or a chain of π centres.
 *
 * The connection matrix is built and diagonalised. Benzene's famous pattern is not stored anywhere — it comes out
 * because six carbons in a ring give that matrix, and a six-carbon chain gives a different one and a different
 * answer.
 */
export function huckel(atoms: number, ring: boolean, electrons?: number): HuckelReport | ChemistryError {
  const n = Math.round(atoms)
  if (!finite(atoms) || n < 2) return fail('invalid-argument', `${atoms} π centres is not enough.`, 'Two is the smallest that has any interaction at all.')
  if (n > 30) return fail('too-many', `${n} centres is more than this handles.`, 'Thirty is the limit; beyond that Hückel theory is too crude to be worth the arithmetic anyway.')

  // α on the diagonal, β between bonded neighbours. Measured in units where α = 0 and β = 1, so the energies
  // come out directly as "how many β above α".
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let one = 0; one < n - 1; one += 1) {
    matrix[one][one + 1] = 1
    matrix[one + 1][one] = 1
  }
  if (ring) {
    if (n < 3) return fail('invalid-argument', 'A ring needs at least three centres.', 'Two in a ring would be the same bond twice.')
    matrix[0][n - 1] = 1
    matrix[n - 1][0] = 1
  }

  const energies = eigenvalues(matrix)
  const count = electrons === undefined ? n : Math.round(electrons)
  if (!finite(count) || count < 0 || count > 2 * n) {
    return fail('invalid-argument', `${electrons} π electrons cannot go into ${n} orbitals.`, `At most two per orbital, so between 0 and ${2 * n}.`)
  }

  const occupancy = new Array<number>(n).fill(0)
  let left = count
  for (let one = 0; one < n && left > 0; one += 1) {
    const put = Math.min(2, left)
    occupancy[one] = put
    left -= put
  }
  const totalEnergy = energies.reduce((sum, one, at) => sum + one * occupancy[at], 0)

  // Against the same electrons in isolated double bonds: each is worth 2β. That difference is what "aromatic
  // stabilisation" names, and for benzene it comes out at exactly 2β.
  const isolated = Math.floor(count / 2) * 2
  const highest = occupancy.lastIndexOf(2) >= 0 ? occupancy.lastIndexOf(2) : occupancy.findIndex((one) => one > 0)
  const homo = highest >= 0 ? energies[highest] : Number.NaN
  const lumoAt = occupancy.findIndex((one) => one < 2)
  const lumo = lumoAt >= 0 ? energies[lumoAt] : Number.NaN

  // The 4n+2 rule: a ring with 2, 6, 10, 14… π electrons in a flat conjugated ring is aromatic.
  const fourNPlusTwo = ring && count >= 2 && (count - 2) % 4 === 0
  const fourN = ring && count >= 4 && count % 4 === 0

  return {
    shape: ring ? `a ring of ${n}` : `a chain of ${n}`,
    atoms: n,
    energies,
    occupancy,
    totalEnergy,
    delocalisationEnergy: totalEnergy - isolated,
    homo,
    lumo,
    gap: Number.isFinite(homo) && Number.isFinite(lumo) ? homo - lumo : Number.NaN,
    aromatic: {
      is: fourNPlusTwo,
      why: !ring
        ? 'A chain cannot be aromatic — aromaticity needs a closed ring of overlapping p orbitals.'
        : fourNPlusTwo
          ? `${count} π electrons is 4n+2, so by Hückel's rule this ring is aromatic — and the delocalisation energy of ${(totalEnergy - isolated).toFixed(4)}β is the arithmetic agreeing.`
          : fourN
            ? `${count} π electrons is 4n, which makes this antiaromatic — actively less stable than the open chain, not merely un-aromatic.`
            : `${count} π electrons is neither 4n nor 4n+2, so the rule says nothing. The ring is simply non-aromatic.`
    },
    assumptions: [
      'Hückel theory is π electrons only. The σ framework is assumed fixed and is not treated at all.',
      'Every atom is taken as identical and every bond as the same length. A real molecule with a heteroatom or a strained ring needs adjusted parameters.',
      'α and β are not calculated, they are parameters. All energies here are in units of β above α, which is why they are pure numbers.',
      'Electron repulsion is ignored entirely. That is the single biggest approximation, and it is why Hückel gets trends right and absolute energies wrong.',
      'The ring is assumed flat. A large ring that puckers escapes antiaromaticity by doing so, and this cannot show that.'
    ]
  }
}

// ——— Beer-Lambert ————————————————————————————————————————————————————————

export interface BeerReport {
  absorbance: number
  transmittance: number
  /** As a percentage, which is how a spectrophotometer reports it. */
  transmittancePercent: number
  concentration: number
  pathLength: number
  molarAbsorptivity: number
  /** Set when the reading is outside where the law can be trusted. */
  warning: string | null
  assumptions: readonly string[]
}

/** Beer-Lambert, solved for whichever quantity is left out. */
export function beerLambert(given: {
  absorbance?: number
  concentration?: number
  pathLength?: number
  molarAbsorptivity?: number
  transmittance?: number
}): BeerReport | ChemistryError {
  let { absorbance, concentration, pathLength, molarAbsorptivity } = given

  if (absorbance === undefined && finite(given.transmittance)) {
    if (given.transmittance <= 0 || given.transmittance > 1) {
      return fail('invalid-argument', `A transmittance of ${given.transmittance} is impossible.`, 'It is a fraction between 0 and 1 — use 0.5 for 50%.')
    }
    absorbance = -Math.log10(given.transmittance)
  }

  const have = [absorbance, concentration, pathLength, molarAbsorptivity].filter(finite).length
  if (have < 3) {
    return fail('no-data', `Three of the four are needed, and ${have} were given.`, 'Absorbance, concentration, path length and molar absorptivity — give any three and this works out the fourth.')
  }

  if (!finite(absorbance)) absorbance = (molarAbsorptivity as number) * (concentration as number) * (pathLength as number)
  else if (!finite(concentration)) concentration = absorbance / ((molarAbsorptivity as number) * (pathLength as number))
  else if (!finite(pathLength)) pathLength = absorbance / ((molarAbsorptivity as number) * (concentration as number))
  else molarAbsorptivity = absorbance / ((concentration as number) * (pathLength as number))

  if (!finite(absorbance) || !finite(concentration) || !finite(pathLength) || !finite(molarAbsorptivity)) {
    return fail('not-finite', 'The arithmetic did not give a real answer.', 'Usually a division by zero — check none of the values given is zero.')
  }
  if (concentration < 0 || pathLength <= 0 || molarAbsorptivity < 0) {
    return fail('invalid-argument', 'That gives a negative concentration, path length or absorptivity.', 'Check the values: one of them is the wrong way round.')
  }

  const transmittance = 10 ** -absorbance
  return {
    absorbance,
    transmittance,
    transmittancePercent: transmittance * 100,
    concentration,
    pathLength,
    molarAbsorptivity,
    warning:
      absorbance > 2
        ? `An absorbance of ${absorbance.toFixed(3)} means under 1% of the light gets through. Real instruments are unreliable above about 2 — dilute the sample rather than trusting this.`
        : absorbance < 0.01
          ? `An absorbance of ${absorbance.toFixed(5)} is down in the noise of most instruments. The number is arithmetically right and experimentally meaningless.`
          : null,
    assumptions: [
      'Monochromatic light. A broad band through a sharp absorption gives a curved calibration rather than a straight one.',
      'Dilute solution. Above about 0.01 mol/L the molecules start to affect each other and the law bends.',
      'No scattering and no fluorescence, both of which make a sample look more or less absorbing than it is.',
      'Molar absorptivity depends on the wavelength and the solvent, so a value from one set of conditions does not transfer to another.'
    ]
  }
}

/** Every element this engine has isotope data for, for a lab to show. */
export const ISOTOPE_ELEMENTS: readonly string[] = Object.freeze(
  Object.keys(ISOTOPES).filter((one) => ALL_ELEMENTS.some((two) => two.symbol === one))
)
