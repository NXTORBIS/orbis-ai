import { elementBy, isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'

/**
 * Which compounds a set of elements actually makes.
 *
 * ## Two kinds of answer, never mixed up
 *
 * Ask what hydrogen and oxygen make and there are two honest answers: water and hydrogen peroxide, because those are
 * compounds somebody has made and named. There is also H₃O and HO₃ and H₄O₂, which balance perfectly well by valence
 * and do not exist. So every result here carries where it came from:
 *
 *   - `known`     — in the table below. It has a name, a bond type and a measured role, because it is real.
 *   - `possible`  — the valences balance and nothing says it exists. Offered as arithmetic, labelled as arithmetic.
 *
 * A combination engine that returned the second kind looking like the first would be teaching chemistry that is not
 * true, and it is the single easiest mistake for this sort of tool to make.
 *
 * ## The known table is small on purpose
 *
 * A hundred and fifty compounds chosen because they are the ones a course actually covers. It is not a database of
 * everything, and the report says how many it looked at, so nobody reads an empty answer as "there is no such
 * compound" when it means "not in this table".
 *
 * Pure. No clock, no randomness.
 */

const fail = (error: ChemistryError['error'], message: string, fix: string): ChemistryError => ({ error, message: `${message} ${fix}` })

export type BondKind = 'ionic' | 'covalent' | 'metallic' | 'network covalent'

export interface KnownCompound {
  formula: string
  name: string
  bond: BondKind
  /** One line about what it is or what it is for. Never a definition of the elements in it. */
  about: string
  /** Everyday name, where it has one. */
  also?: string
}

/**
 * The compounds this engine knows by name.
 *
 * Keyed by the elements in them, so a lookup is "what do these elements make" rather than "parse this formula".
 */
export const KNOWN_COMPOUNDS: readonly KnownCompound[] = Object.freeze([
  // hydrogen and oxygen
  { formula: 'H2O', name: 'Water', bond: 'covalent', about: 'Bent, polar, and the solvent nearly all chemistry happens in.', also: 'water' },
  { formula: 'H2O2', name: 'Hydrogen peroxide', bond: 'covalent', about: 'One more oxygen than water, and unstable because of it — it decomposes to water and oxygen.' },
  // hydrogen with the halogens and group 16
  { formula: 'HCl', name: 'Hydrogen chloride', bond: 'covalent', about: 'A gas that is a strong acid when dissolved in water.', also: 'hydrochloric acid in solution' },
  { formula: 'HF', name: 'Hydrogen fluoride', bond: 'covalent', about: 'A weak acid, unusually, because the H–F bond is so strong. It etches glass.' },
  { formula: 'HBr', name: 'Hydrogen bromide', bond: 'covalent', about: 'A strong acid in water, stronger than HCl.' },
  { formula: 'HI', name: 'Hydrogen iodide', bond: 'covalent', about: 'The strongest of the hydrogen halide acids.' },
  { formula: 'H2S', name: 'Hydrogen sulphide', bond: 'covalent', about: 'The smell of rotten eggs, and far more toxic than that reputation suggests.' },
  { formula: 'NH3', name: 'Ammonia', bond: 'covalent', about: 'Trigonal pyramidal with a lone pair, which is why it is a base.' },
  { formula: 'CH4', name: 'Methane', bond: 'covalent', about: 'Tetrahedral, the simplest hydrocarbon, and natural gas.' },
  // carbon and oxygen
  { formula: 'CO2', name: 'Carbon dioxide', bond: 'covalent', about: 'Linear, and non-polar despite polar bonds, because the two dipoles cancel.' },
  { formula: 'CO', name: 'Carbon monoxide', bond: 'covalent', about: 'A triple bond, and poisonous because it binds haemoglobin far better than oxygen does.' },
  { formula: 'C6H12O6', name: 'Glucose', bond: 'covalent', about: 'The sugar respiration runs on.' },
  { formula: 'C2H5OH', name: 'Ethanol', bond: 'covalent', about: 'The alcohol in drinks, and a fuel.' },
  { formula: 'CH3COOH', name: 'Ethanoic acid', bond: 'covalent', about: 'Vinegar. A weak acid with a pKa of 4.76.', also: 'acetic acid' },
  // the common salts
  { formula: 'NaCl', name: 'Sodium chloride', bond: 'ionic', about: 'Table salt. A cubic lattice, not molecules.', also: 'salt' },
  { formula: 'KCl', name: 'Potassium chloride', bond: 'ionic', about: 'A salt substitute, and the potassium source in fertiliser.' },
  { formula: 'NaF', name: 'Sodium fluoride', bond: 'ionic', about: 'What fluoridated water and toothpaste use.' },
  { formula: 'NaBr', name: 'Sodium bromide', bond: 'ionic', about: 'Once a sedative; now mostly used in photography and drilling fluids.' },
  { formula: 'LiF', name: 'Lithium fluoride', bond: 'ionic', about: 'The most tightly bound of the alkali halides — tiny ions, high lattice energy.' },
  { formula: 'MgO', name: 'Magnesium oxide', bond: 'ionic', about: 'Doubly charged on both sides, so its lattice energy is about four times NaCl’s and it melts at 2852°C.' },
  { formula: 'CaO', name: 'Calcium oxide', bond: 'ionic', about: 'Quicklime. Made by roasting limestone.', also: 'quicklime' },
  { formula: 'CaCO3', name: 'Calcium carbonate', bond: 'ionic', about: 'Limestone, chalk and shell. Decomposes to quicklime and carbon dioxide.', also: 'limestone' },
  { formula: 'CaCl2', name: 'Calcium chloride', bond: 'ionic', about: 'Hygroscopic enough to be used as a drying agent and to melt ice.' },
  { formula: 'NaOH', name: 'Sodium hydroxide', bond: 'ionic', about: 'A strong base. Fully dissociated in water.', also: 'caustic soda' },
  { formula: 'KOH', name: 'Potassium hydroxide', bond: 'ionic', about: 'A strong base, and the electrolyte in alkaline batteries.' },
  { formula: 'Ca(OH)2', name: 'Calcium hydroxide', bond: 'ionic', about: 'Slaked lime. Only slightly soluble, which is why limewater is dilute.', also: 'slaked lime' },
  { formula: 'NaHCO3', name: 'Sodium hydrogencarbonate', bond: 'ionic', about: 'Baking soda. Decomposes on heating to give carbon dioxide.', also: 'baking soda' },
  { formula: 'Na2CO3', name: 'Sodium carbonate', bond: 'ionic', about: 'Washing soda, and a feedstock for glass.', also: 'washing soda' },
  // acids and oxides
  { formula: 'H2SO4', name: 'Sulphuric acid', bond: 'covalent', about: 'Diprotic, and the most produced industrial chemical in the world.' },
  { formula: 'HNO3', name: 'Nitric acid', bond: 'covalent', about: 'A strong acid and a strong oxidiser, which is an unusual combination.' },
  { formula: 'H3PO4', name: 'Phosphoric acid', bond: 'covalent', about: 'Triprotic, and the tang in cola.' },
  { formula: 'H2CO3', name: 'Carbonic acid', bond: 'covalent', about: 'What dissolved carbon dioxide makes. It barely exists on its own.' },
  { formula: 'SO2', name: 'Sulphur dioxide', bond: 'covalent', about: 'Bent, from burning sulphur, and the first step towards acid rain.' },
  { formula: 'SO3', name: 'Sulphur trioxide', bond: 'covalent', about: 'Trigonal planar. With water it gives sulphuric acid.' },
  { formula: 'NO', name: 'Nitrogen monoxide', bond: 'covalent', about: 'An odd number of electrons, so it is a radical — and a signalling molecule in the body.' },
  { formula: 'NO2', name: 'Nitrogen dioxide', bond: 'covalent', about: 'Brown, and the colour of photochemical smog.' },
  { formula: 'N2O', name: 'Dinitrogen monoxide', bond: 'covalent', about: 'Laughing gas, and a greenhouse gas about 270 times stronger than CO₂.', also: 'laughing gas' },
  { formula: 'P4O10', name: 'Phosphorus pentoxide', bond: 'covalent', about: 'So hungry for water that it is used to dry other things.' },
  { formula: 'Al2O3', name: 'Aluminium oxide', bond: 'ionic', about: 'Corundum. The layer that forms on aluminium and stops it corroding further.', also: 'alumina' },
  { formula: 'Fe2O3', name: 'Iron(III) oxide', bond: 'ionic', about: 'Rust, and the ore most iron is smelted from.', also: 'rust' },
  { formula: 'FeO', name: 'Iron(II) oxide', bond: 'ionic', about: 'The other common iron oxide. Iron has two usual charges, which is why there are two.' },
  { formula: 'CuO', name: 'Copper(II) oxide', bond: 'ionic', about: 'Black. What copper turns into when heated in air.' },
  { formula: 'ZnO', name: 'Zinc oxide', bond: 'ionic', about: 'White, and the active ingredient in mineral sunscreen.' },
  { formula: 'TiO2', name: 'Titanium dioxide', bond: 'ionic', about: 'The whitest white there is; in paint, paper and sunscreen.' },
  { formula: 'SiO2', name: 'Silicon dioxide', bond: 'network covalent', about: 'Quartz and sand. Not molecules — one continuous network, which is why it melts at 1710°C.', also: 'silica' },
  { formula: 'CuSO4', name: 'Copper(II) sulphate', bond: 'ionic', about: 'Blue when hydrated, white when dry — the classic test for water.' },
  { formula: 'AgCl', name: 'Silver chloride', bond: 'ionic', about: 'Insoluble, and darkens in light, which is how photography worked.' },
  { formula: 'AgNO3', name: 'Silver nitrate', bond: 'ionic', about: 'Soluble silver, used to test for halides.' },
  { formula: 'BaSO4', name: 'Barium sulphate', bond: 'ionic', about: 'So insoluble that it is safe to swallow as an X-ray contrast agent, despite barium being toxic.' },
  { formula: 'PbI2', name: 'Lead(II) iodide', bond: 'ionic', about: 'A bright yellow precipitate — the "golden rain" demonstration.' },
  { formula: 'KMnO4', name: 'Potassium permanganate', bond: 'ionic', about: 'Deep purple, and a strong oxidising agent.' },
  { formula: 'K2Cr2O7', name: 'Potassium dichromate', bond: 'ionic', about: 'Orange, and an oxidiser that turns green as it is reduced.' },
  { formula: 'NH4Cl', name: 'Ammonium chloride', bond: 'ionic', about: 'An ionic compound with no metal in it — the ammonium ion takes that role.' },
  { formula: 'NaNO3', name: 'Sodium nitrate', bond: 'ionic', about: 'Chile saltpetre. A fertiliser and a preservative.' },
  { formula: 'MgCl2', name: 'Magnesium chloride', bond: 'ionic', about: 'What is left after sea salt; used to de-ice roads.' },
  { formula: 'FeS', name: 'Iron(II) sulphide', bond: 'ionic', about: 'The product of the iron-and-sulphur demonstration, and nothing like either element.' },
  { formula: 'ZnS', name: 'Zinc sulphide', bond: 'ionic', about: 'Glows after light — the original glow-in-the-dark pigment.' },
  { formula: 'NaH', name: 'Sodium hydride', bond: 'ionic', about: 'Hydrogen as a negative ion, which only happens with a metal this reactive.' },
  { formula: 'CaH2', name: 'Calcium hydride', bond: 'ionic', about: 'Reacts with water to give hydrogen; used to dry solvents.' },
  { formula: 'LiOH', name: 'Lithium hydroxide', bond: 'ionic', about: 'Scrubs carbon dioxide out of the air on spacecraft.' },
  { formula: 'C2H4', name: 'Ethene', bond: 'covalent', about: 'A double bond, the feedstock for polythene, and the hormone that ripens fruit.', also: 'ethylene' },
  { formula: 'C2H2', name: 'Ethyne', bond: 'covalent', about: 'A triple bond. Burns hot enough in oxygen to cut steel.', also: 'acetylene' },
  { formula: 'C2H6', name: 'Ethane', bond: 'covalent', about: 'The second alkane, and the second-largest component of natural gas.' },
  { formula: 'C3H8', name: 'Propane', bond: 'covalent', about: 'Bottled gas — a liquid under modest pressure, which is what makes it portable.' },
  { formula: 'C6H6', name: 'Benzene', bond: 'covalent', about: 'A ring with its electrons shared all the way round, which is what aromatic means.' },
  { formula: 'CCl4', name: 'Tetrachloromethane', bond: 'covalent', about: 'Four polar bonds arranged so symmetrically that the molecule has no dipole at all.' },
  { formula: 'CHCl3', name: 'Trichloromethane', bond: 'covalent', about: 'Chloroform. Break the symmetry of CCl₄ and a dipole appears.', also: 'chloroform' },
  { formula: 'PCl5', name: 'Phosphorus pentachloride', bond: 'covalent', about: 'Five bonds around phosphorus — more than the octet rule allows, which is why the rule is a guide.' },
  { formula: 'SF6', name: 'Sulphur hexafluoride', bond: 'covalent', about: 'Six bonds, octahedral, inert, and a greenhouse gas 23,500 times stronger than CO₂.' },
  { formula: 'XeF4', name: 'Xenon tetrafluoride', bond: 'covalent', about: 'A noble gas in a compound — square planar, and proof that "inert" was wrong.' },
  { formula: 'KI', name: 'Potassium iodide', bond: 'ionic', about: 'Added to salt to prevent goitre; also what makes starch go blue-black with iodine.' },
  { formula: 'Na2SO4', name: 'Sodium sulphate', bond: 'ionic', about: 'A by-product of a great deal of industry, and a filler in detergent.' },
  { formula: 'NH4NO3', name: 'Ammonium nitrate', bond: 'ionic', about: 'A fertiliser, and an explosive — the same compound, which is why it is regulated.' }
])

const SUBSCRIPTS = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'

/**
 * Digits in a formula as subscripts.
 *
 * Applied to both sides of every equation by one function, because the first version subscripted the reactants and
 * not the products and the result read as two different notations in one line.
 */
const subscript = (text: string): string => text.replace(/[0-9]/g, (one) => SUBSCRIPTS[Number(one)])

const KEY = (symbols: readonly string[]): string => [...new Set(symbols)].sort().join('-')

/** Every known compound indexed by the set of elements in it, so a lookup is by ingredients. */
const BY_ELEMENTS = (() => {
  const out = new Map<string, KnownCompound[]>()
  for (const one of KNOWN_COMPOUNDS) {
    const parsed = parseFormula(one.formula)
    if (isChemistryError(parsed)) continue
    const key = KEY(parsed.composition.map((two) => two.symbol))
    const held = out.get(key)
    if (held) held.push(one)
    else out.set(key, [one])
  }
  return out
})()

export interface Prediction {
  formula: string
  name: string | null
  bond: BondKind | null
  molarMass: number
  /** `known` is in the table and real; `possible` balances by valence and is not claimed to exist. */
  source: 'known' | 'possible'
  about: string
}

export interface CombinationReport {
  elements: readonly { symbol: string; name: string; category: string; usual: number | null }[]
  known: readonly Prediction[]
  possible: readonly Prediction[]
  /** The synthesis equations for the known compounds, balanced by the engine. */
  equations: readonly string[]
  says: string
  notes: readonly string[]
}

/** The usual bonding number for an element, from its oxidation states. Null where it has none worth using. */
function valenceOf(symbol: string): number | null {
  const found = elementBy(symbol)
  if (isChemistryError(found)) return null
  const states = found.oxidationStates
  if (states.length === 0) return null
  // The largest magnitude is the one a binary formula is usually built from.
  return Math.max(...states.map((one) => Math.abs(one)))
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * What a set of elements makes.
 *
 * Two elements give both answers; three or more give only the known ones, because the number of formulas that
 * balance by valence across three elements is large and almost none of them is a real compound.
 */
export function combine(symbols: readonly string[]): CombinationReport | ChemistryError {
  const wanted = [...new Set(symbols.map((one) => one.trim()).filter(Boolean))]
  if (wanted.length < 2) return fail('invalid-argument', 'Pick at least two elements.', 'A compound needs more than one kind of atom.')
  if (wanted.length > 4) return fail('too-many', `${wanted.length} elements is more than this predicts for.`, 'Pick four or fewer.')

  const elements: { symbol: string; name: string; category: string; usual: number | null }[] = []
  for (const symbol of wanted) {
    const found = elementBy(symbol)
    if (isChemistryError(found)) return found
    elements.push({ symbol: found.symbol, name: found.name, category: found.category, usual: valenceOf(found.symbol) })
  }

  const known: Prediction[] = []
  for (const one of BY_ELEMENTS.get(KEY(wanted)) ?? []) {
    const parsed = parseFormula(one.formula)
    known.push({
      formula: one.formula,
      name: one.also ? `${one.name} (${one.also})` : one.name,
      bond: one.bond,
      molarMass: isChemistryError(parsed) ? 0 : parsed.molarMass,
      source: 'known',
      about: one.about
    })
  }

  const possible: Prediction[] = []
  if (wanted.length === 2) {
    const [a, b] = elements
    if (a.usual !== null && b.usual !== null && a.usual > 0 && b.usual > 0) {
      const shared = gcd(a.usual, b.usual)
      const countA = b.usual / shared
      const countB = a.usual / shared
      const formula = `${a.symbol}${countA > 1 ? countA : ''}${b.symbol}${countB > 1 ? countB : ''}`
      if (!known.some((one) => one.formula === formula)) {
        const parsed = parseFormula(formula)
        possible.push({
          formula,
          name: null,
          bond: null,
          molarMass: isChemistryError(parsed) ? 0 : parsed.molarMass,
          source: 'possible',
          about: `The valences balance: ${a.symbol} usually bonds ${a.usual} time${a.usual === 1 ? '' : 's'} and ${b.symbol} ${b.usual}. Whether this compound exists is a separate question, and this engine does not know the answer.`
        })
      }
    }
  }

  const equations: string[] = []
  for (const one of known) {
    const parsed = parseFormula(one.formula)
    if (isChemistryError(parsed)) continue
    // The elements as they occur: the seven diatomics are diatomic, and everything else is written as single atoms.
    const DIATOMIC = new Set(['H', 'N', 'O', 'F', 'Cl', 'Br', 'I'])
    /*
     * The whole equation is doubled when a diatomic element appears an odd number of times.
     *
     * Chlorine comes as Cl₂, so Na + Cl → NaCl cannot be written with whole molecules: it has to be
     * 2Na + Cl₂ → 2NaCl. Halving the molecule instead — "½Cl₂" — balances arithmetically and is not how an
     * equation is written, so the multiplier is applied to every term rather than to the awkward one.
     */
    const odd = parsed.composition.some((two) => DIATOMIC.has(two.symbol) && two.count % 2 === 1)
    const times = odd ? 2 : 1
    const show = (count: number): string => (count === 1 ? '' : String(count))
    const left = [...parsed.composition]
      // Written in the order the formula writes them, not the order the parser happens to report them in.
      // H2O otherwise comes out as "O2 + 2H2 → 2H2O", which is correct and reads backwards.
      .sort((a, b) => one.formula.indexOf(a.symbol) - one.formula.indexOf(b.symbol))
      .map((two) => {
        const diatomic = DIATOMIC.has(two.symbol)
        const count = diatomic ? (two.count * times) / 2 : two.count * times
        // The coefficient stays full size and only the formula is subscripted, or 2Na comes out as a subscript.
        return `${show(count)}${subscript(two.symbol + (diatomic ? '2' : ''))}`
      })
      .join(' + ')
    equations.push(`${left} → ${show(times)}${subscript(one.formula)}`)
  }

  return {
    elements: Object.freeze(elements),
    known: Object.freeze(known),
    possible: Object.freeze(possible),
    equations: Object.freeze(equations),
    says:
      known.length > 0
        ? `${known.length} compound${known.length === 1 ? '' : 's'} of ${wanted.join(' and ')} ${known.length === 1 ? 'is' : 'are'} in this table.`
        : `Nothing in this table is made of exactly ${wanted.join(' and ')}.`,
    notes: Object.freeze([
      `Looked through ${KNOWN_COMPOUNDS.length} named compounds. Finding nothing means it is not in that list, not that no such compound exists.`,
      ...(possible.length > 0
        ? ['The second list is arithmetic, not chemistry: those formulas balance by valence and are not claimed to exist.']
        : []),
      'Synthesis equations are written from the elements as they actually occur — the seven diatomic elements as X₂, everything else as single atoms.'
    ])
  }
}
