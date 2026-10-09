import { isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'

/**
 * Organic chemistry: the functional groups, and naming a straight chain.
 *
 * ## Why the naming is arithmetic and not a lookup
 *
 * A table of "C₂H₆ is called ethane" teaches nothing, because the thing worth learning is that the name is built:
 * a stem for how many carbons, a suffix for what the chain is, and a prefix for anything hanging off it. So the
 * namer here assembles the word from the parts, which means it can name a chain of nine carbons with a ketone on
 * it without that case having been written down anywhere.
 *
 * ## What it refuses
 *
 * Straight chains only, with one functional group. Branches, rings, more than one group, stereochemistry and
 * cis/trans are all outside it, and it says so by name rather than returning a word that is nearly right — a
 * nearly-right IUPAC name is the worst possible output, because it looks authoritative and is wrong.
 */

const fail = (error: ChemistryError['error'], message: string, fix: string): ChemistryError => ({ error, message: `${message} ${fix}` })

export type GroupId =
  | 'alkane'
  | 'alkene'
  | 'alkyne'
  | 'alcohol'
  | 'aldehyde'
  | 'ketone'
  | 'carboxylic-acid'
  | 'ester'
  | 'ether'
  | 'amine'
  | 'amide'
  | 'aromatic'
  | 'haloalkane'
  | 'nitro'

export interface FunctionalGroup {
  id: GroupId
  name: string
  /** What the group itself is, written the way a formula is written. */
  group: string
  /** The general formula for the family. */
  general: string
  /** What the name of a compound in this family ends in. */
  suffix: string
  /** The prefix, where the group is named as a substituent instead. */
  prefix: string | null
  example: { formula: string; name: string; everyday: string | null }
  /** What this family characteristically does. Reactions, not adjectives. */
  reactions: readonly { does: string; with: string; gives: string }[]
  /** How it behaves, and why — polarity, boiling point, solubility. */
  behaviour: string
  /** How to tell it is there, in a laboratory. */
  test: string | null
}

/** The fourteen families. The order is the order a course meets them in, not alphabetical. */
export const FUNCTIONAL_GROUPS: readonly FunctionalGroup[] = Object.freeze([
  {
    id: 'alkane',
    name: 'Alkane',
    group: '—C—C—',
    general: 'CₙH₂ₙ₊₂',
    suffix: '-ane',
    prefix: 'alkyl-',
    example: { formula: 'C3H8', name: 'Propane', everyday: 'bottled gas' },
    reactions: [
      { does: 'Combustion', with: 'oxygen', gives: 'carbon dioxide and water, and a great deal of heat' },
      { does: 'Free-radical substitution', with: 'a halogen in ultraviolet light', gives: 'a haloalkane and a hydrogen halide' },
      { does: 'Cracking', with: 'heat and a catalyst', gives: 'a shorter alkane and an alkene' }
    ],
    behaviour:
      'Only C–H and C–C bonds, both barely polar, so there is nothing for a reagent to attack. That is why alkanes are the unreactive family and why their only easy reactions need a radical or a flame to start them.',
    test: 'No reaction with bromine water in the dark — the absence is the test, and it distinguishes an alkane from an alkene.'
  },
  {
    id: 'alkene',
    name: 'Alkene',
    group: 'C=C',
    general: 'CₙH₂ₙ',
    suffix: '-ene',
    prefix: 'alkenyl-',
    example: { formula: 'C2H4', name: 'Ethene', everyday: 'ethylene — ripens fruit, and becomes polythene' },
    reactions: [
      { does: 'Electrophilic addition', with: 'bromine', gives: 'a dibromoalkane — and the orange colour vanishes' },
      { does: 'Hydrogenation', with: 'hydrogen over nickel', gives: 'the alkane' },
      { does: 'Hydration', with: 'steam and an acid catalyst', gives: 'an alcohol' },
      { does: 'Addition polymerisation', with: 'itself, under pressure', gives: 'a polymer — the double bond opens and joins up' }
    ],
    behaviour:
      'The double bond is a region of high electron density, so an alkene attracts anything electron-poor. Every characteristic reaction is an addition across that bond, and every one of them destroys it.',
    test: 'Bromine water goes from orange to colourless, with no light needed. This is the standard test for unsaturation.'
  },
  {
    id: 'alkyne',
    name: 'Alkyne',
    group: 'C≡C',
    general: 'CₙH₂ₙ₋₂',
    suffix: '-yne',
    prefix: 'alkynyl-',
    example: { formula: 'C2H2', name: 'Ethyne', everyday: 'acetylene — the welding gas' },
    reactions: [
      { does: 'Addition', with: 'hydrogen or a halogen', gives: 'first the alkene, then the alkane — two additions, not one' },
      { does: 'Hydration', with: 'water and a mercury(II) catalyst', gives: 'a ketone, by way of an enol that rearranges' },
      { does: 'Deprotonation', with: 'a strong base, for a terminal alkyne', gives: 'an acetylide — the only hydrocarbon hydrogen that is meaningfully acidic' }
    ],
    behaviour:
      'Three bonds between two carbons, and the geometry is linear because there are only two electron domains on each. A terminal alkyne has an unusually acidic hydrogen, because the carbon holding it is sp-hybridised and holds the negative charge better.',
    test: 'Bromine water decolourises, like an alkene; a terminal alkyne also gives a precipitate with ammoniacal silver nitrate, which an alkene does not.'
  },
  {
    id: 'alcohol',
    name: 'Alcohol',
    group: '—OH',
    general: 'CₙH₂ₙ₊₁OH',
    suffix: '-ol',
    prefix: 'hydroxy-',
    example: { formula: 'C2H5OH', name: 'Ethanol', everyday: 'the alcohol in drinks' },
    reactions: [
      { does: 'Oxidation', with: 'acidified potassium dichromate', gives: 'an aldehyde then an acid, if primary; a ketone, if secondary; nothing, if tertiary' },
      { does: 'Dehydration', with: 'concentrated sulphuric acid', gives: 'an alkene' },
      { does: 'Esterification', with: 'a carboxylic acid', gives: 'an ester and water' },
      { does: 'Substitution', with: 'a hydrogen halide', gives: 'a haloalkane' }
    ],
    behaviour:
      'The O–H bond lets alcohols hydrogen-bond, which is the whole story: ethanol boils at 78°C while ethane, nearly the same size, boils at −89°C. The short ones mix with water in any proportion; past about four carbons the chain wins and solubility drops.',
    test: 'What happens with acidified dichromate separates the three classes — orange to green for primary and secondary, no change for tertiary.'
  },
  {
    id: 'aldehyde',
    name: 'Aldehyde',
    group: '—CHO',
    general: 'CₙH₂ₙO',
    suffix: '-al',
    prefix: 'oxo-',
    example: { formula: 'CH3CHO', name: 'Ethanal', everyday: 'acetaldehyde — what the body makes from alcohol' },
    reactions: [
      { does: 'Oxidation', with: "Tollens' reagent", gives: 'a carboxylic acid, and a silver mirror on the glass' },
      { does: 'Oxidation', with: "Fehling's solution", gives: 'a carboxylic acid, and a brick-red precipitate' },
      { does: 'Reduction', with: 'sodium borohydride', gives: 'a primary alcohol' },
      { does: 'Nucleophilic addition', with: 'hydrogen cyanide', gives: 'a hydroxynitrile — one carbon longer' }
    ],
    behaviour:
      'The carbonyl carbon is electron-poor, so nucleophiles add to it. An aldehyde still has a hydrogen on that carbon, which is exactly why it can be oxidised further and a ketone cannot.',
    test: "Tollens' gives a silver mirror and Fehling's a red precipitate — both positive for an aldehyde and negative for a ketone, which is the distinction those tests exist for."
  },
  {
    id: 'ketone',
    name: 'Ketone',
    group: '—CO—',
    general: 'CₙH₂ₙO',
    suffix: '-one',
    prefix: 'oxo-',
    example: { formula: 'CH3COCH3', name: 'Propanone', everyday: 'acetone — nail varnish remover' },
    reactions: [
      { does: 'Reduction', with: 'sodium borohydride', gives: 'a secondary alcohol' },
      { does: 'Nucleophilic addition', with: 'hydrogen cyanide', gives: 'a hydroxynitrile' },
      { does: 'Iodination', with: 'iodine and alkali, if it has a methyl next to the carbonyl', gives: 'a yellow precipitate of triiodomethane' }
    ],
    behaviour:
      'Same carbonyl as an aldehyde, and the same addition chemistry, but with carbon on both sides there is no hydrogen to lose — so mild oxidising agents do nothing at all. A ketone has the same general formula as an aldehyde, which is why they are isomers.',
    test: 'Gives a positive 2,4-DNP test like an aldehyde, and a negative Tollens — the pair together identifies which carbonyl it is.'
  },
  {
    id: 'carboxylic-acid',
    name: 'Carboxylic acid',
    group: '—COOH',
    general: 'CₙH₂ₙO₂',
    suffix: '-oic acid',
    prefix: 'carboxy-',
    example: { formula: 'CH3COOH', name: 'Ethanoic acid', everyday: 'vinegar' },
    reactions: [
      { does: 'Neutralisation', with: 'a base', gives: 'a salt and water' },
      { does: 'Reaction', with: 'a carbonate', gives: 'a salt, water and carbon dioxide — the fizzing is the test' },
      { does: 'Esterification', with: 'an alcohol and an acid catalyst', gives: 'an ester and water' },
      { does: 'Reduction', with: 'lithium aluminium hydride', gives: 'a primary alcohol — borohydride is not strong enough' }
    ],
    behaviour:
      'Weak acids, pKa around 4 to 5, because the anion left behind spreads its charge over two oxygens. They hydrogen-bond in pairs, so they boil higher than the alcohol of the same size.',
    test: 'Add sodium carbonate: carbon dioxide is given off. Phenols are acidic too but do not do this, which is how the two are told apart.'
  },
  {
    id: 'ester',
    name: 'Ester',
    group: '—COO—',
    general: 'CₙH₂ₙO₂',
    suffix: '-yl -oate',
    prefix: null,
    example: { formula: 'CH3COOC2H5', name: 'Ethyl ethanoate', everyday: 'the pear-drop smell, and a solvent' },
    reactions: [
      { does: 'Acid hydrolysis', with: 'water and acid', gives: 'the acid and the alcohol back — an equilibrium' },
      { does: 'Base hydrolysis', with: 'sodium hydroxide', gives: 'the salt of the acid and the alcohol, and it goes to completion' },
      { does: 'Transesterification', with: 'a different alcohol', gives: 'a different ester — this is how biodiesel is made' }
    ],
    behaviour:
      'No O–H, so no hydrogen bonding between ester molecules — which is why they are volatile and smell, and why they boil well below the acid they came from. The name is in two parts, alcohol first: ethyl ethanoate is the ethyl ester of ethanoic acid.',
    test: 'The smell is characteristic, and warming with alkali followed by acidification brings the carboxylic acid back.'
  },
  {
    id: 'ether',
    name: 'Ether',
    group: '—O—',
    general: 'CₙH₂ₙ₊₂O',
    suffix: 'ether (or alkoxy-alkane)',
    prefix: 'alkoxy-',
    example: { formula: 'C2H5OC2H5', name: 'Ethoxyethane', everyday: 'diethyl ether — once the anaesthetic' },
    reactions: [
      { does: 'Cleavage', with: 'a hot concentrated hydrogen halide', gives: 'an alcohol and a haloalkane — and it takes harsh conditions' },
      { does: 'Autoxidation', with: 'oxygen, on standing in air', gives: 'peroxides, which is why old bottles of ether are dangerous' }
    ],
    behaviour:
      'An oxygen with two carbons on it: polar bonds and a lone pair, so an ether accepts a hydrogen bond but cannot donate one. That makes it an excellent solvent and nearly inert otherwise, which is the whole reason it is used as one.',
    test: 'No positive result in the usual functional-group tests — the absence of a reaction, with oxygen present in the formula, is the clue.'
  },
  {
    id: 'amine',
    name: 'Amine',
    group: '—NH₂',
    general: 'CₙH₂ₙ₊₁NH₂',
    suffix: '-amine',
    prefix: 'amino-',
    example: { formula: 'CH3NH2', name: 'Methylamine', everyday: 'the smell of rotting fish' },
    reactions: [
      { does: 'Acting as a base', with: 'an acid', gives: 'an ammonium salt — the lone pair takes the proton' },
      { does: 'Nucleophilic substitution', with: 'a haloalkane', gives: 'a more substituted amine' },
      { does: 'Acylation', with: 'an acyl chloride', gives: 'an amide' }
    ],
    behaviour:
      'A nitrogen lone pair, so an amine is both a base and a nucleophile — and those are the same property seen from two sides. An alkyl group pushes electrons towards the nitrogen, so alkylamines are stronger bases than ammonia; attach it to a benzene ring instead and it becomes far weaker, because the ring pulls the lone pair in.',
    test: 'Turns damp red litmus blue, and gives a white smoke of the salt when held over concentrated hydrochloric acid.'
  },
  {
    id: 'amide',
    name: 'Amide',
    group: '—CONH₂',
    general: 'CₙH₂ₙ₊₁NO',
    suffix: '-amide',
    prefix: 'carbamoyl-',
    example: { formula: 'CH3CONH2', name: 'Ethanamide', everyday: null },
    reactions: [
      { does: 'Hydrolysis', with: 'acid or alkali, and heat', gives: 'the carboxylic acid and ammonia or the amine' },
      { does: 'Reduction', with: 'lithium aluminium hydride', gives: 'an amine' },
      { does: 'Condensation', with: 'another amino acid', gives: 'a peptide — the amide bond is the link in every protein' }
    ],
    behaviour:
      'Nitrogen next to a carbonyl, and its lone pair is drawn into the C=O — so unlike an amine, an amide is not basic at all. That same sharing makes the bond flat and hard to rotate, which is what gives proteins their shape.',
    test: 'Warming with alkali releases ammonia, which can be smelled and turns damp red litmus blue.'
  },
  {
    id: 'aromatic',
    name: 'Aromatic',
    group: 'C₆H₅—',
    general: 'CₙH₂ₙ₋₆ for a benzene ring',
    suffix: 'benzene (or -benzene)',
    prefix: 'phenyl-',
    example: { formula: 'C6H6', name: 'Benzene', everyday: null },
    reactions: [
      { does: 'Electrophilic substitution', with: 'concentrated nitric and sulphuric acid', gives: 'nitrobenzene — substitution, because addition would destroy the ring' },
      { does: 'Halogenation', with: 'a halogen and a halogen-carrier catalyst', gives: 'a halobenzene' },
      { does: 'Friedel–Crafts', with: 'a haloalkane or acyl chloride and aluminium chloride', gives: 'an alkyl- or acylbenzene' }
    ],
    behaviour:
      'Six electrons shared around the whole ring, and that delocalisation is worth about 150 kJ/mol — which is why benzene substitutes rather than adds. Every characteristic aromatic reaction keeps the ring, and the Kekulé picture of alternating bonds is a drawing, not the molecule: every C–C bond is the same length.',
    test: 'Does not decolourise bromine water, despite the double bonds in the drawing. That failure is the evidence for delocalisation.'
  },
  {
    id: 'haloalkane',
    name: 'Haloalkane',
    group: '—X (F, Cl, Br, I)',
    general: 'CₙH₂ₙ₊₁X',
    suffix: 'halide',
    prefix: 'fluoro-, chloro-, bromo-, iodo-',
    example: { formula: 'CH3Br', name: 'Bromomethane', everyday: null },
    reactions: [
      { does: 'Nucleophilic substitution', with: 'aqueous hydroxide', gives: 'an alcohol' },
      { does: 'Nucleophilic substitution', with: 'cyanide', gives: 'a nitrile — one carbon longer' },
      { does: 'Elimination', with: 'hot ethanolic hydroxide', gives: 'an alkene — the same reagent, a different solvent, a different product' },
      { does: 'Substitution', with: 'ammonia', gives: 'an amine' }
    ],
    behaviour:
      'A polar C–X bond with the carbon slightly positive, so nucleophiles attack it. Reactivity follows bond strength and not polarity: the C–I bond is the weakest and iodoalkanes react fastest, even though C–F is the most polar.',
    test: 'Warm with silver nitrate in ethanol — chloride gives a white precipitate slowly, bromide cream faster, iodide yellow fastest.'
  },
  {
    id: 'nitro',
    name: 'Nitro compound',
    group: '—NO₂',
    general: 'CₙH₂ₙ₊₁NO₂',
    suffix: 'nitro- (named as a prefix)',
    prefix: 'nitro-',
    example: { formula: 'C6H5NO2', name: 'Nitrobenzene', everyday: null },
    reactions: [
      { does: 'Reduction', with: 'tin and concentrated hydrochloric acid', gives: 'an amine — this is how aniline is made' },
      { does: 'Deactivating a ring', with: 'nothing — it is already attached', gives: 'a benzene ring much slower to substitute, and directed to the 3-position' }
    ],
    behaviour:
      'Strongly electron-withdrawing, by both induction and delocalisation. On a benzene ring it pulls electron density out and so slows every further substitution down, and sends the next group to the meta position.',
    test: 'Reduction to the amine, which then gives the amine tests. There is no single direct spot test.'
  }
])

export const GROUP_BY_ID: Readonly<Record<string, FunctionalGroup>> = Object.freeze(
  Object.fromEntries(FUNCTIONAL_GROUPS.map((one) => [one.id, one]))
)

// ---------------------------------------------------------------- naming

/** The stems. Position in the list is the carbon count, so index 0 is unused. */
const STEMS: readonly string[] = Object.freeze([
  '',
  'meth',
  'eth',
  'prop',
  'but',
  'pent',
  'hex',
  'hept',
  'oct',
  'non',
  'dec',
  'undec',
  'dodec'
])

export interface NamingRule {
  step: number
  rule: string
  why: string
  example: string
}

/** The five rules the namer actually applies, in the order it applies them. */
export const NAMING_RULES: readonly NamingRule[] = Object.freeze([
  {
    step: 1,
    rule: 'Find the longest continuous chain of carbons. That is the parent, and it decides the stem.',
    why: 'The name describes a backbone with things attached, so the backbone has to be chosen before anything else can be named.',
    example: 'Five carbons in a row → pent-, whatever is hanging off it.'
  },
  {
    step: 2,
    rule: 'Name the principal functional group and make it the suffix.',
    why: 'Only one group can be the suffix. There is an order of seniority — acid, then ester, then amide, aldehyde, ketone, alcohol, amine — and the senior one wins; the rest become prefixes.',
    example: 'A chain with both an alcohol and a ketone is named as the -one, with hydroxy- as a prefix.'
  },
  {
    step: 3,
    rule: 'Number the chain from the end that gives the principal group the lowest number.',
    why: 'Two numberings are always possible and they give different names. The rule exists so that one molecule has one name.',
    example: 'CH₃CH₂CH₂OH is propan-1-ol, never propan-3-ol.'
  },
  {
    step: 4,
    rule: 'Name every substituent as a prefix with its number, and list them alphabetically.',
    why: 'Alphabetical, not by size or by position — so that two people naming the same molecule write the same word.',
    example: '2-chloro-3-methylpentane: chloro before methyl, although methyl is further along.'
  },
  {
    step: 5,
    rule: 'Assemble: prefixes, then stem, then suffix. Use di-, tri-, tetra- for repeats, and hyphens around numbers.',
    why: 'The shape of the written name is itself part of the standard, so a name can be read back into a structure.',
    example: '2,3-dibromobutane — one word, numbers comma-separated, hyphen before the prefix.'
  }
])

export interface NameReport {
  name: string
  formula: string
  carbons: number
  group: FunctionalGroup
  position: number | null
  molarMass: number
  /** The name taken apart, so the assembling is visible rather than just the answer. */
  parts: readonly { piece: string; is: string; because: string }[]
  says: string
  notes: readonly string[]
}

/**
 * Name a straight chain of carbons carrying one functional group.
 *
 * Built from the parts, not looked up. `position` is the carbon the group sits on, 1-based; where the group can only
 * be at the end — an aldehyde, an acid — the position is forced to 1 and that is said rather than silently applied.
 */
export function nameChain(input: { carbons: number; group: GroupId; position?: number }): NameReport | ChemistryError {
  const { carbons } = input
  if (!Number.isInteger(carbons) || carbons < 1) return fail('invalid-argument', 'The chain needs a whole number of carbons, at least one.', 'Try 1 to 12.')
  if (carbons >= STEMS.length) return fail('too-many', `${carbons} carbons is past the stems this knows.`, `It goes up to ${STEMS.length - 1}.`)

  const group = GROUP_BY_ID[input.group]
  if (!group) return fail('invalid-argument', `There is no functional group called "${input.group}".`, `Try one of: ${FUNCTIONAL_GROUPS.slice(0, 5).map((one) => one.id).join(', ')}.`)
  if (group.id === 'aromatic' || group.id === 'ester' || group.id === 'ether') {
    return fail(
      'no-data',
      `${group.name}s are not named from a straight chain.`,
      group.id === 'aromatic'
        ? 'An aromatic name is built on the ring, not on a chain.'
        : 'Those names have two parts, one from each side of the oxygen, so a single chain length does not describe them.'
    )
  }

  const stem = STEMS[carbons]
  const notes: string[] = []

  // Where the group can be, and where it is.
  const endOnly = group.id === 'aldehyde' || group.id === 'carboxylic-acid' || group.id === 'amide' || group.id === 'alkane'
  const needsPosition = !endOnly && carbons >= 3
  let position: number | null = null
  if (!endOnly) {
    const asked = input.position ?? 1
    // A double or triple bond is named by the lower of the two carbons it joins, so its last legal position is n-1.
    const last = group.id === 'alkene' || group.id === 'alkyne' ? carbons - 1 : carbons
    if (!Number.isInteger(asked) || asked < 1 || asked > Math.max(1, last)) {
      return fail('invalid-argument', `Carbon ${asked} is not a place this group can go on a chain of ${carbons}.`, `It has to be between 1 and ${Math.max(1, last)}.`)
    }
    // Rule 3: number from whichever end gives the lower number. Asking for 3 on a chain of 4 means the same molecule as 2.
    const mirrored = group.id === 'alkene' || group.id === 'alkyne' ? carbons - asked : carbons + 1 - asked
    position = Math.min(asked, mirrored)
    if (position !== asked) {
      notes.push(
        `Carbon ${asked} and carbon ${position} are the same molecule counted from opposite ends, and rule 3 says use the lower — so this is named ${position}, not ${asked}.`
      )
    }
    if (group.id === 'ketone' && carbons < 3) {
      return fail('no-data', 'A ketone needs at least three carbons.', 'The carbonyl must have a carbon on both sides, so the shortest ketone is propanone.')
    }
  }

  // The suffix, with the position inside it where IUPAC puts it.
  const SUFFIX: Readonly<Record<string, string>> = {
    alkane: 'ane',
    alkene: 'ene',
    alkyne: 'yne',
    alcohol: 'anol',
    aldehyde: 'anal',
    ketone: 'anone',
    'carboxylic-acid': 'anoic acid',
    amine: 'anamine',
    haloalkane: 'ane',
    nitro: 'ane',
    amide: 'anamide'
  }
  const tail = SUFFIX[group.id] ?? 'ane'
  const prefix = group.id === 'haloalkane' ? 'chloro' : group.id === 'nitro' ? 'nitro' : ''

  let name: string
  if (prefix) {
    name = `${needsPosition && position !== null ? `${position}-` : ''}${prefix}${stem}${tail}`
  } else if (needsPosition && position !== null) {
    // For -ene and -yne the number sits before the suffix; for -ol, -one, -amine likewise, after the 'an'.
    name = group.id === 'alkene' || group.id === 'alkyne' ? `${stem}-${position}-${tail}` : `${stem}an-${position}-${tail.slice(2)}`
  } else {
    name = `${stem}${tail}`
  }

  // The formula, counted rather than looked up.
  const hydrogens = ((): number => {
    switch (group.id) {
      case 'alkane':
        return 2 * carbons + 2
      case 'alkene':
        return 2 * carbons
      case 'alkyne':
        return 2 * carbons - 2
      case 'alcohol':
        return 2 * carbons + 2
      case 'aldehyde':
      case 'ketone':
        return 2 * carbons
      case 'carboxylic-acid':
        return 2 * carbons
      case 'amine':
        return 2 * carbons + 3
      case 'amide':
        return 2 * carbons + 1
      case 'haloalkane':
        return 2 * carbons + 1
      case 'nitro':
        return 2 * carbons + 1
      default:
        return 2 * carbons + 2
    }
  })()
  const extra =
    group.id === 'alcohol' || group.id === 'aldehyde' || group.id === 'ketone'
      ? 'O'
      : group.id === 'carboxylic-acid'
        ? 'O2'
        : group.id === 'amine'
          ? 'N'
          : group.id === 'amide'
            ? 'NO'
            : group.id === 'haloalkane'
              ? 'Cl'
              : group.id === 'nitro'
                ? 'NO2'
                : ''
  const formula = `C${carbons > 1 ? carbons : ''}H${hydrogens > 1 ? hydrogens : ''}${extra}`
  const parsed = parseFormula(formula)

  const parts: NameReport['parts'] = Object.freeze([
    ...(prefix ? [{ piece: `${needsPosition && position !== null ? `${position}-` : ''}${prefix}`, is: 'the prefix', because: `${group.name}s are named as a substituent, with the position in front (rule 4).` }] : []),
    { piece: stem, is: 'the stem', because: `${carbons} carbon${carbons === 1 ? '' : 's'} in the chain (rule 1).` },
    ...(needsPosition && position !== null && !prefix
      ? [{ piece: String(position), is: 'the position', because: `The group is on carbon ${position}, counted from the end that gives the lower number (rule 3).` }]
      : []),
    { piece: tail.replace(/^an/, prefix ? 'an' : ''), is: 'the suffix', because: `${group.name} is the principal group, so it takes the suffix (rule 2).` }
  ])

  if (endOnly && group.id !== 'alkane') {
    notes.push(`${group.name}s can only be at the end of a chain, so there is no number in the name — carbon 1 is the only option.`)
  }
  notes.push('Straight chain, one functional group. Branches, rings, more than one group and any stereochemistry are outside this.')

  return {
    name,
    formula,
    carbons,
    group,
    position,
    molarMass: isChemistryError(parsed) ? 0 : parsed.molarMass,
    parts,
    says: `${carbons} carbon${carbons === 1 ? '' : 's'} with ${group.name === 'Alkane' ? 'no functional group' : `${group.group} on it`} is ${name}, ${formula}.`,
    notes: Object.freeze(notes)
  }
}

/** The groups that `nameChain` will actually name, so a control can offer only those. */
export const NAMEABLE: readonly GroupId[] = Object.freeze([
  'alkane',
  'alkene',
  'alkyne',
  'alcohol',
  'aldehyde',
  'ketone',
  'carboxylic-acid',
  'amine',
  'amide',
  'haloalkane',
  'nitro'
])

/** The first twelve members of a family, as a homologous series. */
export function homologousSeries(group: GroupId, upTo = 8): readonly NameReport[] | ChemistryError {
  if (!NAMEABLE.includes(group)) return fail('no-data', `${group} is not one this builds a series for.`, `Try: ${NAMEABLE.join(', ')}.`)
  const out: NameReport[] = []
  for (let carbons = 1; carbons <= Math.min(upTo, STEMS.length - 1); carbons += 1) {
    const named = nameChain({ carbons, group })
    if (isChemistryError(named)) continue // the short impossible ones, such as a one-carbon ketone
    out.push(named)
  }
  if (out.length === 0) return fail('no-data', 'No member of that series could be built.', 'Try a different family.')
  return Object.freeze(out)
}
