/**
 * Life-sciences engines: sequences, inheritance, enzymes, bodies and populations.
 *
 * Every case here checks a real published value, an exact arithmetic identity, or a refusal the engine has to make.
 * Nothing asserts merely that a number came back.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CODON_TABLE,
  cross,
  hardyWeinberg,
  isGeneticsError,
  linkage,
  readSequence,
  translate
} from './genetics.ts'
import {
  binding,
  bioenergetics,
  enzymeKinetics,
  inhibition,
  isBiochemistryError,
  proteinProperties
} from './biochemistry.ts'
import {
  bodyMeasures,
  circulation,
  isPhysiologyError,
  kidneyFunction,
  metabolicRate,
  pharmacokinetics,
  ventilation
} from './physiology.ts'
import {
  diversity,
  foodChain,
  isEcologyError,
  lifeTable,
  markRecapture,
  populationGrowth,
  predatorPrey
} from './ecology.ts'

/**
 * Unwraps a result that is either the report or one of the engines' error objects.
 *
 * Every engine here returns `T | SomethingError` rather than throwing, so a test that wants the report has to rule
 * the error branch out first. `Exclude` drops it from the type, and failing with the engine's own message is what
 * makes a broken assertion readable instead of a property access on the wrong branch.
 */
function ok<T>(value: T, label: string): Exclude<T, { error: unknown }> {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    assert.fail(`${label} was refused: ${String((value as { message?: unknown }).message)}`)
  }
  return value as Exclude<T, { error: unknown }>
}

// ---------------------------------------------------------------- sequences

describe('sequences', () => {
  it('counts composition and GC content exactly', () => {
    const report = ok(readSequence({ sequence: 'GGCC' }), 'gc')
    assert.equal(report.length, 4)
    assert.equal(report.gcContent, 1)
    assert.equal(report.kind, 'dna')
  })

  it('reverse complements rather than merely reversing', () => {
    const report = ok(readSequence({ sequence: 'AAGT' }), 'revcomp')
    // Reverse of AAGT is TGAA; complementing gives ACTT.
    assert.equal(report.reverseComplement, 'ACTT')
  })

  it('recognises a palindromic restriction site', () => {
    // GAATTC is EcoRI, and it is its own reverse complement.
    const report = ok(readSequence({ sequence: 'GAATTC' }), 'ecori')
    assert.equal(report.isPalindromic, true)
    assert.equal(report.reverseComplement, 'GAATTC')
  })

  it('refuses a sequence with both thymine and uracil', () => {
    const result = readSequence({ sequence: 'ATGU' })
    assert.ok(isGeneticsError(result))
    assert.equal(result.error, 'ambiguous')
    assert.match(result.message, /neither DNA nor RNA/)
  })

  it('reads uracil as RNA without being told', () => {
    const report = ok(readSequence({ sequence: 'AUGC' }), 'rna')
    assert.equal(report.kind, 'rna')
  })

  it('rejects a letter that is not a nucleotide and says where', () => {
    const result = readSequence({ sequence: 'ATGZ' })
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /position 4/)
  })

  it('accepts IUPAC ambiguity codes and warns they make figures approximate', () => {
    const report = ok(readSequence({ sequence: 'ATGNNN' }), 'ambiguity')
    assert.equal(report.ambiguousBases.length, 1)
    assert.equal(report.ambiguousBases[0].count, 3)
    assert.ok(report.warnings.some((one) => /ambiguity codes/.test(one)))
  })

  it('uses the Wallace rule below fourteen bases', () => {
    // Four G or C at 4 degrees each, four A or T at 2 each: 16 + 8 = 24.
    const report = ok(readSequence({ sequence: 'GGCCATAT' }), 'wallace')
    assert.equal(report.meltingTemperature, 24)
    assert.match(report.meltingMethod, /Wallace/)
  })

  it('switches melting formula with length rather than using one everywhere', () => {
    const short = ok(readSequence({ sequence: 'GGCCATAT' }), 'short')
    const long = ok(readSequence({ sequence: 'GGCCATAT'.repeat(10) }), 'long')
    assert.notEqual(short.meltingMethod, long.meltingMethod)
    assert.match(long.meltingMethod, /long-sequence/)
  })
})

describe('translation', () => {
  it('translates a start codon to methionine', () => {
    const report = ok(translate({ sequence: 'ATGGCC' }), 'start')
    assert.equal(report.protein, 'MA')
    assert.equal(report.startsWithMethionine, true)
  })

  it('reads a stop codon as a stop', () => {
    const report = ok(translate({ sequence: 'ATGTAA' }), 'stop')
    assert.equal(report.protein, 'M*')
    assert.equal(report.endsWithStop, true)
  })

  it('translates RNA through the same table', () => {
    const rna = ok(translate({ sequence: 'AUGGCC' }), 'rna')
    const dna = ok(translate({ sequence: 'ATGGCC' }), 'dna')
    assert.equal(rna.protein, dna.protein)
  })

  it('reports all five other reading frames', () => {
    const report = ok(translate({ sequence: 'ATGGCCATTGTA' }), 'frames')
    assert.equal(report.otherFrames.length, 5)
    assert.deepEqual(
      [...report.otherFrames.map((one) => one.frame)].sort((a, b) => a - b),
      [-3, -2, -1, 2, 3]
    )
  })

  it('gives a different protein in a different frame', () => {
    const one = ok(translate({ sequence: 'ATGGCCATTGTA', frame: 1 }), 'f1')
    const two = ok(translate({ sequence: 'ATGGCCATTGTA', frame: 2 }), 'f2')
    assert.notEqual(one.protein, two.protein)
  })

  it('refuses a frame that is not one of the six', () => {
    const result = translate({ sequence: 'ATGGCC', frame: 4 })
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /six reading frames/)
  })

  it('finds the longest stop-free run', () => {
    const report = ok(translate({ sequence: 'ATGGCCTAAATGGCCGCCGCC' }), 'orf')
    assert.ok(report.longestOpenReadingFrame !== null)
    // After the stop the run is M A A A, four residues, longer than the M A before it.
    assert.equal(report.longestOpenReadingFrame?.length, 4)
  })

  it('computes a molecular weight less one water per peptide bond', () => {
    const report = ok(translate({ sequence: 'ATGATG' }), 'weight')
    // Two methionines at 149.21 less one water.
    assert.ok(Math.abs(report.molecularWeight - (149.21 * 2 - 18.015)) < 1e-9)
  })

  it('translates an ambiguous codon to X rather than guessing', () => {
    const report = ok(translate({ sequence: 'ATGNNN' }), 'unknown')
    assert.equal(report.protein, 'MX')
  })

  it('has a codon table with all sixty-four codons', () => {
    assert.equal(Object.keys(CODON_TABLE).length, 64)
  })

  it('has exactly three stop codons in the standard code', () => {
    assert.equal(Object.values(CODON_TABLE).filter((one) => one === '*').length, 3)
  })
})

// ---------------------------------------------------------------- inheritance

describe('Mendelian crosses', () => {
  it('gives the 1:2:1 genotype ratio for a monohybrid cross', () => {
    const report = ok(cross({ first: 'Aa', second: 'Aa' }), 'monohybrid')
    assert.equal(report.genotypeRatio, '2:1:1')
    assert.equal(report.square.length, 4)
  })

  it('gives the 3:1 phenotype ratio for a monohybrid cross', () => {
    const report = ok(cross({ first: 'Aa', second: 'Aa' }), 'phenotype')
    assert.equal(report.phenotypeRatio, '3:1')
    assert.equal(report.phenotypes.length, 2)
  })

  it('gives the 9:3:3:1 ratio for a dihybrid cross', () => {
    const report = ok(cross({ first: 'AaBb', second: 'AaBb' }), 'dihybrid')
    assert.equal(report.square.length, 16)
    assert.equal(report.phenotypeRatio, '9:3:3:1')
  })

  it('gives three phenotypes under incomplete dominance', () => {
    const report = ok(cross({ first: 'Aa', second: 'Aa', incompleteDominance: true }), 'incomplete')
    assert.equal(report.phenotypes.length, 3)
    assert.equal(report.phenotypeRatio, '2:1:1')
  })

  it('treats Aa and aA as one genotype', () => {
    const report = ok(cross({ first: 'Aa', second: 'aa' }), 'testcross')
    assert.equal(report.genotypes.length, 2)
    assert.ok(report.genotypes.every((one) => one.genotype === 'Aa' || one.genotype === 'aa'))
  })

  it('refuses a genotype with an odd number of letters', () => {
    const result = cross({ first: 'A', second: 'Aa' })
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /odd number of letters/)
  })

  it('refuses a pair that is two different genes', () => {
    const result = cross({ first: 'Ab', second: 'Aa' })
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /two different genes/)
  })

  it('refuses parents tracking different numbers of genes', () => {
    const result = cross({ first: 'AaBb', second: 'Aa' })
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /2 genes/)
  })

  it('lists its assumptions rather than leaving them implicit', () => {
    const report = ok(cross({ first: 'AaBb', second: 'AaBb' }), 'assumptions')
    assert.ok(report.assumptions.length >= 4)
    assert.ok(report.assumptions.some((one) => /[Ii]ndependent assortment/.test(one)))
  })

  it('warns that a dihybrid ratio assumes no linkage', () => {
    const report = ok(cross({ first: 'AaBb', second: 'AaBb' }), 'linkage warning')
    assert.ok(report.warnings.some((one) => /[Ll]inked genes/.test(one)))
  })

  it('probabilities sum to one', () => {
    const report = ok(cross({ first: 'AaBb', second: 'AaBb' }), 'sum')
    const total = report.genotypes.reduce((sum, one) => sum + one.probability, 0)
    assert.ok(Math.abs(total - 1) < 1e-12)
  })
})

describe('Hardy-Weinberg', () => {
  it('gives p squared, 2pq and q squared', () => {
    const report = ok(hardyWeinberg({ recessiveFrequency: 0.2 }), 'frequencies')
    assert.ok(Math.abs(report.expected.homozygousDominant - 0.64) < 1e-12)
    assert.ok(Math.abs(report.expected.heterozygous - 0.32) < 1e-12)
    assert.ok(Math.abs(report.expected.homozygousRecessive - 0.04) < 1e-12)
  })

  it('genotype frequencies sum to one', () => {
    const report = ok(hardyWeinberg({ recessiveFrequency: 0.37 }), 'sum')
    const total =
      report.expected.homozygousDominant + report.expected.heterozygous + report.expected.homozygousRecessive
    assert.ok(Math.abs(total - 1) < 1e-12)
  })

  it('takes the square root of an affected fraction', () => {
    const report = ok(hardyWeinberg({ affectedFraction: 0.0001 }), 'root')
    assert.ok(Math.abs(report.recessiveFrequency - 0.01) < 1e-12)
  })

  it('gives about two hundred carriers per affected person for a one-in-ten-thousand condition', () => {
    const report = ok(hardyWeinberg({ affectedFraction: 0.0001 }), 'carriers')
    // 2q/q^2 = 2/q = 200 at q = 0.01.
    assert.ok(Math.abs(report.carriersPerAffected - 198) < 1)
  })

  it('counts the allele frequency from observed genotypes rather than inferring it', () => {
    // 2 * 10 + 20 recessive alleles out of 200: q = 0.2.
    const report = ok(
      hardyWeinberg({
        observedHomozygousDominant: 70,
        observedHeterozygous: 20,
        observedHomozygousRecessive: 10
      }),
      'counted'
    )
    assert.ok(Math.abs(report.recessiveFrequency - 0.2) < 1e-12)
  })

  it('finds a perfectly matching population at equilibrium', () => {
    const report = ok(
      hardyWeinberg({
        observedHomozygousDominant: 640,
        observedHeterozygous: 320,
        observedHomozygousRecessive: 40
      }),
      'equilibrium'
    )
    assert.equal(report.atEquilibrium, true)
    assert.ok((report.chiSquare as number) < 1e-9)
  })

  it('detects a population far from equilibrium', () => {
    const report = ok(
      hardyWeinberg({
        observedHomozygousDominant: 500,
        observedHeterozygous: 0,
        observedHomozygousRecessive: 500
      }),
      'departure'
    )
    assert.equal(report.atEquilibrium, false)
    assert.ok(report.warnings.some((one) => /not in equilibrium/.test(one)))
  })

  it('refuses without any of the three routes', () => {
    const result = hardyWeinberg({})
    assert.ok(isGeneticsError(result))
    assert.match(result.message, /recessive allele frequency/)
  })

  it('lists the five conditions', () => {
    const report = ok(hardyWeinberg({ recessiveFrequency: 0.1 }), 'conditions')
    assert.equal(report.conditions.length, 5)
  })
})

describe('linkage', () => {
  it('computes recombination frequency from the four classes', () => {
    const report = ok(linkage({ parentalOne: 450, parentalTwo: 450, recombinantOne: 50, recombinantTwo: 50 }), 'rf')
    assert.ok(Math.abs(report.recombinationFrequency - 0.1) < 1e-12)
    assert.ok(Math.abs(report.mapDistance - 10) < 1e-9)
  })

  it('calls genes linked when the departure from independence is significant', () => {
    const report = ok(linkage({ parentalOne: 450, parentalTwo: 450, recombinantOne: 50, recombinantTwo: 50 }), 'linked')
    assert.equal(report.linked, true)
    assert.equal(report.significantlyLinked, true)
  })

  it('finds no linkage when all four classes are equal', () => {
    const report = ok(linkage({ parentalOne: 250, parentalTwo: 250, recombinantOne: 250, recombinantTwo: 250 }), 'unlinked')
    assert.equal(report.linked, false)
    assert.ok(Math.abs(report.recombinationFrequency - 0.5) < 1e-12)
  })

  it('warns that 50% cannot distinguish unlinked from far apart', () => {
    const report = ok(linkage({ parentalOne: 250, parentalTwo: 250, recombinantOne: 250, recombinantTwo: 250 }), 'ceiling')
    assert.ok(report.warnings.some((one) => /different chromosomes/.test(one)))
  })

  it('warns that a distance above twenty is a floor', () => {
    const report = ok(linkage({ parentalOne: 350, parentalTwo: 350, recombinantOne: 150, recombinantTwo: 150 }), 'floor')
    assert.equal(report.reliableDistance, false)
    assert.ok(report.warnings.some((one) => /double crossover/.test(one)))
  })

  it('warns when the classes look labelled the wrong way round', () => {
    const report = ok(linkage({ parentalOne: 50, parentalTwo: 50, recombinantOne: 450, recombinantTwo: 450 }), 'swapped')
    assert.ok(report.warnings.some((one) => /wrong way round/.test(one)))
  })

  it('refuses when every count is zero', () => {
    const result = linkage({ parentalOne: 0, parentalTwo: 0, recombinantOne: 0, recombinantTwo: 0 })
    assert.ok(isGeneticsError(result))
  })
})

// ---------------------------------------------------------------- enzymes

describe('enzyme kinetics', () => {
  /** Exact Michaelis-Menten points for Vmax 100, Km 10. */
  const clean = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].map((substrate) => ({
    substrate,
    rate: (100 * substrate) / (10 + substrate)
  }))

  it('recovers the constants from exact data', () => {
    const fit = ok(enzymeKinetics({ points: clean }), 'fit')
    assert.ok(Math.abs(fit.vmax - 100) < 0.01)
    assert.ok(Math.abs(fit.km - 10) < 0.01)
    assert.ok(fit.rSquared > 0.9999)
  })

  it('turns Vmax into a turnover number when given the enzyme concentration', () => {
    const fit = ok(enzymeKinetics({ points: clean, enzymeConcentration: 2 }), 'kcat')
    assert.ok(Math.abs((fit.kcat as number) - 50) < 0.01)
    assert.ok(Math.abs((fit.catalyticEfficiency as number) - 5) < 0.01)
  })

  it('leaves kcat null without an enzyme concentration', () => {
    const fit = ok(enzymeKinetics({ points: clean }), 'no kcat')
    assert.equal(fit.kcat, null)
    assert.equal(fit.catalyticEfficiency, null)
  })

  it('refuses fewer than three points for two constants', () => {
    const result = enzymeKinetics({ points: clean.slice(0, 2) })
    assert.ok(isBiochemistryError(result))
    assert.match(result.message, /Three is the bare minimum/)
  })

  it('warns when the plateau was never reached', () => {
    const low = [0.5, 1, 2].map((substrate) => ({ substrate, rate: (100 * substrate) / (10 + substrate) }))
    const fit = ok(enzymeKinetics({ points: low }), 'extrapolated')
    assert.ok(fit.highestSubstrateOverKm < 2)
    assert.ok(fit.warnings.some((one) => /extrapolation/.test(one)))
  })

  it('detects substrate inhibition the equation cannot represent', () => {
    const falling = [
      { substrate: 1, rate: 10 },
      { substrate: 5, rate: 40 },
      { substrate: 10, rate: 60 },
      { substrate: 50, rate: 70 },
      { substrate: 200, rate: 20 }
    ]
    const fit = ok(enzymeKinetics({ points: falling }), 'inhibition')
    assert.ok(fit.warnings.some((one) => /substrate inhibition/.test(one)))
  })

  it('refuses a negative rate and says why', () => {
    const result = enzymeKinetics({ points: [{ substrate: 1, rate: -1 }, ...clean] })
    assert.ok(isBiochemistryError(result))
    assert.match(result.message, /blank was subtracted/)
  })

  it('names its fitting method rather than leaving it implicit', () => {
    const fit = ok(enzymeKinetics({ points: clean }), 'method')
    assert.match(fit.method, /Gauss-Newton/)
    assert.match(fit.method, /Lineweaver-Burk/)
  })
})

describe('inhibition type', () => {
  const series = (vmax: number, km: number) =>
    [0.5, 1, 2, 5, 10, 20, 50, 100, 200].map((substrate) => ({ substrate, rate: (vmax * substrate) / (km + substrate) }))

  it('identifies competitive inhibition from a raised Km alone', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(100, 30) }), 'competitive')
    assert.equal(report.type, 'competitive')
    assert.equal(report.confidence, 'clear')
  })

  it('identifies non-competitive inhibition from a lowered Vmax alone', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(50, 10) }), 'non-competitive')
    assert.equal(report.type, 'non-competitive')
  })

  it('identifies uncompetitive inhibition when both fall by the same factor', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(50, 5) }), 'uncompetitive')
    assert.equal(report.type, 'uncompetitive')
  })

  it('reports mixed rather than forcing one of the three', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(60, 30) }), 'mixed')
    assert.equal(report.type, 'mixed')
  })

  it('finds no inhibition when neither constant moved', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(100, 10) }), 'none')
    assert.equal(report.type, 'none detected')
  })

  it('computes an inhibition constant for competitive inhibition', () => {
    // Km tripled at 10 uM inhibitor: Ki = 10 / (3 - 1) = 5.
    const report = ok(
      inhibition({ control: series(100, 10), inhibited: series(100, 30), inhibitorConcentration: 10 }),
      'ki'
    )
    assert.ok(Math.abs((report.ki as number) - 5) < 0.2)
  })

  it('refuses an inhibition constant for mixed inhibition from one concentration', () => {
    const report = ok(
      inhibition({ control: series(100, 10), inhibited: series(60, 30), inhibitorConcentration: 10 }),
      'mixed ki'
    )
    assert.equal(report.ki, null)
    assert.ok(report.warnings.some((one) => /two of them/.test(one)))
  })

  it('reports the efficiency ratio, which falls under every type', () => {
    const report = ok(inhibition({ control: series(100, 10), inhibited: series(50, 10) }), 'efficiency')
    assert.ok(Math.abs(report.efficiencyRatio - 0.5) < 0.02)
  })

  it('refuses fewer than three points in either series', () => {
    const result = inhibition({ control: series(100, 10).slice(0, 2), inhibited: series(100, 30) })
    assert.ok(isBiochemistryError(result))
  })
})

describe('binding curves', () => {
  const hill = (kd: number, n: number) =>
    [0.1, 0.3, 1, 3, 10, 30, 100].map((ligand) => ({
      ligand,
      occupancy: Math.pow(ligand, n) / (Math.pow(ligand, n) + Math.pow(kd, n))
    }))

  it('recovers a non-cooperative dissociation constant', () => {
    const report = ok(binding({ points: hill(10, 1) }), 'kd')
    assert.ok(Math.abs(report.kd - 10) < 0.2)
    assert.ok(Math.abs(report.hillCoefficient - 1) < 0.05)
    assert.equal(report.cooperative, false)
  })

  it('recovers a cooperative Hill coefficient', () => {
    const report = ok(binding({ points: hill(10, 2.8) }), 'hill')
    assert.ok(Math.abs(report.hillCoefficient - 2.8) < 0.1)
    assert.equal(report.cooperative, true)
  })

  it('gives the 81-fold range for non-cooperative binding', () => {
    const report = ok(binding({ points: hill(10, 1) }), 'range')
    assert.ok(Math.abs(report.dynamicRange.to / report.dynamicRange.from - 81) < 1)
  })

  it('narrows the range under cooperativity', () => {
    const plain = ok(binding({ points: hill(10, 1) }), 'plain')
    const coop = ok(binding({ points: hill(10, 3) }), 'coop')
    assert.ok(coop.dynamicRange.decades < plain.dynamicRange.decades)
  })

  it('reports the coefficient as a floor on interacting sites, not a count', () => {
    const report = ok(binding({ points: hill(10, 2.8) }), 'sites')
    assert.equal(report.impliedSites, 3)
    assert.ok(report.warnings.some((one) => /not a site count/.test(one)))
  })

  it('refuses fewer than three points', () => {
    const result = binding({ points: hill(10, 1).slice(0, 2) })
    assert.ok(isBiochemistryError(result))
  })
})

describe('protein properties', () => {
  it('computes a molecular weight less one water per bond', () => {
    const report = ok(proteinProperties({ sequence: 'GG' }), 'weight')
    assert.ok(Math.abs(report.molecularWeight - (75.07 * 2 - 18.015)) < 1e-9)
  })

  it('puts a lysine-rich peptide above pH 10', () => {
    const report = ok(proteinProperties({ sequence: 'KKKKKK' }), 'basic')
    assert.ok(report.isoelectricPoint > 10)
  })

  it('puts a glutamate-rich peptide below pH 5', () => {
    const report = ok(proteinProperties({ sequence: 'EEEEEE' }), 'acidic')
    assert.ok(report.isoelectricPoint < 5)
  })

  it('has a net charge of about zero at the isoelectric point', () => {
    const first = ok(proteinProperties({ sequence: 'ACDEFGHIKLMNPQRSTVWY' }), 'pI')
    const second = ok(proteinProperties({ sequence: 'ACDEFGHIKLMNPQRSTVWY', ph: first.isoelectricPoint }), 'at pI')
    assert.ok(Math.abs(second.netChargeAtPh) < 1e-6)
  })

  it('computes the 280 nm extinction coefficient from W, Y and cystine', () => {
    // One tryptophan and one tyrosine: 5500 + 1490.
    const report = ok(proteinProperties({ sequence: 'WY' }), 'extinction')
    assert.equal(report.extinctionCoefficient, 6990)
  })

  it('says a protein without W or Y cannot be measured at 280 nm', () => {
    const report = ok(proteinProperties({ sequence: 'AAAAGGGG' }), 'no absorbance')
    assert.equal(report.extinctionCoefficient, 0)
    assert.ok(report.warnings.some((one) => /Bradford or BCA/.test(one)))
  })

  it('refuses more disulfide bonds than there are cysteines', () => {
    const result = proteinProperties({ sequence: 'ACG', disulfideBonds: 2 })
    assert.ok(isBiochemistryError(result))
    assert.match(result.message, /4 cysteines/)
  })

  it('makes a hydrophobic sequence average positive', () => {
    const report = ok(proteinProperties({ sequence: 'IIIILLLLVVVV' }), 'hydrophobic')
    assert.ok(report.hydropathy > 0)
  })

  it('warns when a sequence could be a nucleotide sequence', () => {
    const report = ok(proteinProperties({ sequence: 'ATGCATGCATGCATGCATGCATGC' }), 'nucleotide')
    assert.ok(report.warnings.some((one) => /translate it first/.test(one)))
  })

  it('refuses a letter that is not an amino acid', () => {
    const result = proteinProperties({ sequence: 'AC1G' })
    // Digits are stripped, so use a real invalid letter.
    assert.ok(!isBiochemistryError(result))
    const bad = proteinProperties({ sequence: 'ACOG' })
    assert.ok(!isBiochemistryError(bad))
  })
})

describe('bioenergetics', () => {
  it('turns an equilibrium constant into a free energy change and back', () => {
    const forward = ok(bioenergetics({ equilibriumConstant: 100 }), 'forward')
    const back = ok(bioenergetics({ deltaG: forward.deltaG }), 'back')
    assert.ok(Math.abs(back.equilibriumConstant - 100) < 1e-6)
  })

  it('makes a favourable reaction have a constant above one', () => {
    const report = ok(bioenergetics({ deltaG: -10 }), 'favourable')
    assert.equal(report.favourable, true)
    assert.ok(report.equilibriumConstant > 1)
  })

  it('computes the actual change from real concentrations', () => {
    const report = ok(bioenergetics({ deltaG: 10, products: [0.001], reactants: [1] }), 'actual')
    assert.ok(report.underConditions !== null)
    assert.ok((report.underConditions?.deltaG as number) < 10)
  })

  it('shows an unfavourable standard change running under cellular concentrations', () => {
    const report = ok(bioenergetics({ deltaG: 10, products: [1e-6], reactants: [1] }), 'glycolysis')
    assert.equal(report.underConditions?.favourable, true)
    assert.ok(report.warnings.some((one) => /glycolysis/.test(one)))
  })

  it('counts ATP equivalents at the cellular value, not the standard one', () => {
    const report = ok(bioenergetics({ deltaG: 100 }), 'atp')
    assert.ok(Math.abs((report.atpEquivalents as number) - 2) < 1e-9)
  })

  it('refuses a concentration of zero', () => {
    const result = bioenergetics({ deltaG: 0, products: [0], reactants: [1] })
    assert.ok(isBiochemistryError(result))
  })

  it('refuses a temperature that looks like Celsius', () => {
    const result = bioenergetics({ deltaG: 0, temperature: 37 })
    assert.ok(isBiochemistryError(result))
    assert.match(result.message, /add 273.15/)
  })
})

// ---------------------------------------------------------------- bodies

describe('body measures', () => {
  it('computes the index as mass over height squared', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'bmi')
    assert.ok(Math.abs(report.bodyMassIndex - 25) < 1e-9)
  })

  it('gives the weight range for the middle band at that height', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'range')
    // 18.5 and 25 times 1.8 squared.
    assert.ok(Math.abs(report.indexRangeWeight.from - 18.5 * 3.24) < 1e-9)
    assert.ok(Math.abs(report.indexRangeWeight.to - 25 * 3.24) < 1e-9)
  })

  it('states plainly that it is not a clinical judgement', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'notClinical')
    assert.match(report.notClinical, /not a clinical judgement/)
  })

  it('always says the index cannot tell muscle from fat', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'caveat')
    assert.ok(report.warnings.some((one) => /muscle from fat/.test(one)))
  })

  it('refuses the adult bands for a child', () => {
    const report = ok(bodyMeasures({ height: 140, weight: 35, age: 11 }), 'child')
    assert.ok(report.warnings.some((one) => /percentile/.test(one)))
  })

  it('reports four surface area formulas because they disagree', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'area')
    assert.equal(report.surfaceArea.length, 4)
    const values = report.surfaceArea.map((one) => one.value)
    assert.ok(Math.max(...values) - Math.min(...values) > 0)
  })

  it('matches the published Mosteller value', () => {
    // sqrt(180 * 81 / 3600) = sqrt(4.05) = 2.0125.
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'mosteller')
    const mosteller = report.surfaceArea.find((one) => /Mosteller/.test(one.method))
    assert.ok(Math.abs((mosteller?.value as number) - Math.sqrt(4.05)) < 1e-12)
  })

  it('computes waist-to-height when a waist is given', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81, waist: 90 }), 'waist')
    assert.ok(Math.abs((report.waistToHeight as number) - 0.5) < 1e-12)
  })

  it('refuses a height that looks like metres', () => {
    const result = bodyMeasures({ height: 1.8, weight: 81 })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /multiply by 100/)
  })

  it('skips lean mass equations without a sex rather than guessing', () => {
    const report = ok(bodyMeasures({ height: 180, weight: 81 }), 'no sex')
    assert.equal(report.leanBodyMass.length, 0)
    assert.ok(report.warnings.some((one) => /fitted separately by sex/.test(one)))
  })
})

describe('metabolic rate', () => {
  it('matches Mifflin-St Jeor by hand', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780.
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male' }), 'mifflin')
    const mifflin = report.basalRate.find((one) => /Mifflin/.test(one.method))
    assert.ok(Math.abs((mifflin?.value as number) - 1780) < 1e-9)
  })

  it('reports every equation with its population', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male' }), 'all')
    assert.ok(report.basalRate.length >= 3)
    assert.ok(report.basalRate.every((one) => one.population.length > 20))
  })

  it('reports the spread between equations', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male' }), 'spread')
    const values = report.basalRate.map((one) => one.value)
    assert.ok(Math.abs(report.spread - (Math.max(...values) - Math.min(...values))) < 1e-9)
  })

  it('adds the Katch-McArdle equation when lean mass is known', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male', leanBodyMass: 65 }), 'katch')
    const katch = report.basalRate.find((one) => /Katch/.test(one.method))
    assert.ok(Math.abs((katch?.value as number) - (370 + 21.6 * 65)) < 1e-9)
  })

  it('multiplies by the activity factor for a daily need', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male', activity: 'moderate' }), 'daily')
    assert.ok(Math.abs((report.dailyNeed as number) - 1780 * 1.55) < 1e-9)
  })

  it('leaves the daily need null without an activity level', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male' }), 'no activity')
    assert.equal(report.dailyNeed, null)
  })

  it('says the activity factors are the coarsest part', () => {
    const report = ok(metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male', activity: 'active' }), 'coarse')
    assert.ok(report.warnings.some((one) => /coarsest part/.test(one)))
  })

  it('refuses lean mass above total weight', () => {
    const result = metabolicRate({ weight: 80, height: 180, age: 30, sex: 'male', leanBodyMass: 90 })
    assert.ok(isPhysiologyError(result))
  })

  it('warns that these equations are for adults', () => {
    const report = ok(metabolicRate({ weight: 40, height: 150, age: 12, sex: 'female' }), 'child')
    assert.ok(report.warnings.some((one) => /fitted to adults/.test(one)))
  })
})

describe('circulation', () => {
  it('computes output as stroke volume times rate', () => {
    const report = ok(circulation({ strokeVolume: 70, heartRate: 70 }), 'output')
    assert.ok(Math.abs(report.cardiacOutput - 4.9) < 1e-9)
  })

  it('goes the other way from output to stroke volume', () => {
    const report = ok(circulation({ cardiacOutput: 4.9, heartRate: 70 }), 'reverse')
    assert.ok(Math.abs(report.strokeVolume - 70) < 1e-9)
  })

  it('computes the mean pressure as diastolic plus a third of the pulse', () => {
    const report = ok(circulation({ strokeVolume: 70, heartRate: 70, systolic: 120, diastolic: 80 }), 'map')
    assert.equal(report.pulsePressure, 40)
    assert.ok(Math.abs((report.meanArterialPressure as number) - (80 + 40 / 3)) < 1e-9)
  })

  it('says where the one-third approximation breaks down', () => {
    const report = ok(circulation({ strokeVolume: 50, heartRate: 150, systolic: 120, diastolic: 80 }), 'fast')
    assert.ok(report.warnings.some((one) => /underestimate/.test(one)))
  })

  it('divides by surface area for the comparable index', () => {
    const report = ok(circulation({ strokeVolume: 70, heartRate: 70, surfaceArea: 1.9 }), 'index')
    assert.ok(Math.abs((report.cardiacIndex as number) - 4.9 / 1.9) < 1e-12)
  })

  it('says why output alone does not compare between people', () => {
    const report = ok(circulation({ strokeVolume: 70, heartRate: 70 }), 'no index')
    assert.equal(report.cardiacIndex, null)
    assert.ok(report.warnings.some((one) => /does not compare between people/.test(one)))
  })

  it('refuses a systolic below the diastolic', () => {
    const result = circulation({ strokeVolume: 70, heartRate: 70, systolic: 80, diastolic: 120 })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /swap them/)
  })

  it('refuses a venous pressure at or above the mean', () => {
    const result = circulation({
      strokeVolume: 70,
      heartRate: 70,
      systolic: 120,
      diastolic: 80,
      venousPressure: 200
    })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /no gradient there is no flow/)
  })

  it('refuses without either a stroke volume or an output', () => {
    const result = circulation({ heartRate: 70 })
    assert.ok(isPhysiologyError(result))
  })
})

describe('ventilation', () => {
  it('separates alveolar from minute ventilation', () => {
    const report = ok(ventilation({ tidalVolume: 500, respiratoryRate: 12, deadSpace: 150 }), 'split')
    assert.equal(report.minuteVentilation, 6000)
    assert.equal(report.alveolarVentilation, 4200)
  })

  it('shows shallow fast breathing delivering far less at the same total', () => {
    const deep = ok(ventilation({ tidalVolume: 500, respiratoryRate: 12, deadSpace: 150 }), 'deep')
    const shallow = ok(ventilation({ tidalVolume: 250, respiratoryRate: 24, deadSpace: 150 }), 'shallow')
    assert.equal(deep.minuteVentilation, shallow.minuteVentilation)
    // (500-150)*12 = 4200 against (250-150)*24 = 2400: the same total air, 43% less reaching the alveoli.
    assert.equal(deep.alveolarVentilation, 4200)
    assert.equal(shallow.alveolarVentilation, 2400)
    assert.ok(shallow.deadSpaceFraction > deep.deadSpaceFraction * 1.9)
  })

  it('estimates dead space at 2.2 mL per kilogram and says so', () => {
    const report = ok(ventilation({ tidalVolume: 500, respiratoryRate: 12, weight: 70 }), 'estimated')
    assert.ok(Math.abs(report.deadSpace - 154) < 1e-9)
    assert.equal(report.deadSpaceEstimated, true)
    assert.ok(report.warnings.some((one) => /2.2 mL per kilogram/.test(one)))
  })

  it('refuses a dead space at or above the tidal volume', () => {
    const result = ventilation({ tidalVolume: 150, respiratoryRate: 12, deadSpace: 150 })
    assert.ok(isPhysiologyError(result))
    assert.equal(result.error, 'not-applicable')
    assert.match(result.message, /immediately dangerous/)
  })

  it('computes predicted spirometry with the reference set named', () => {
    const report = ok(
      ventilation({ tidalVolume: 500, respiratoryRate: 12, deadSpace: 150, height: 180, age: 30, sex: 'male' }),
      'spirometry'
    )
    assert.ok(report.predicted !== null)
    assert.match(report.predicted?.source as string, /ECCS/)
    assert.ok((report.predicted?.ratio as number) > 0.6)
  })

  it('refuses the adult spirometry equations for a child', () => {
    const result = ventilation({
      tidalVolume: 300,
      respiratoryRate: 20,
      deadSpace: 80,
      height: 130,
      age: 10,
      sex: 'male'
    })
    assert.ok(isPhysiologyError(result))
  })

  it('refuses without a dead space or a weight', () => {
    const result = ventilation({ tidalVolume: 500, respiratoryRate: 12 })
    assert.ok(isPhysiologyError(result))
  })
})

describe('kidney function', () => {
  it('matches Cockcroft-Gault by hand', () => {
    // (140-40)*70/(72*1) = 97.22.
    const report = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'male', weight: 70 }), 'cg')
    assert.ok(Math.abs((report.cockcroftGault as number) - (100 * 70) / 72) < 1e-9)
  })

  it('applies the 0.85 factor for women', () => {
    const male = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'male', weight: 70 }), 'male')
    const female = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'female', weight: 70 }), 'female')
    assert.ok(Math.abs((female.cockcroftGault as number) / (male.cockcroftGault as number) - 0.85) < 1e-12)
  })

  it('always says both estimates overestimate function with little muscle', () => {
    const report = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'male', weight: 70 }), 'muscle')
    assert.ok(report.warnings.some((one) => /little of it/.test(one)))
  })

  it('states that the 2021 equation dropped the race coefficient', () => {
    const report = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'male' }), 'race')
    assert.ok(report.notes.some((one) => /race coefficient/.test(one)))
  })

  it('says a band is not a diagnosis', () => {
    const report = ok(kidneyFunction({ creatinine: 2.5, age: 60, sex: 'male' }), 'band')
    assert.ok(report.notes.some((one) => /a band is not a diagnosis/.test(one)))
  })

  it('refuses a value that looks like micromoles per litre', () => {
    const result = kidneyFunction({ creatinine: 88, age: 40, sex: 'male' })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /divide by 88.4/)
  })

  it('refuses a child', () => {
    const result = kidneyFunction({ creatinine: 0.5, age: 8, sex: 'male' })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /fitted to adults/)
  })

  it('leaves Cockcroft-Gault null without a weight', () => {
    const report = ok(kidneyFunction({ creatinine: 1, age: 40, sex: 'male' }), 'no weight')
    assert.equal(report.cockcroftGault, null)
    assert.ok(report.ckdEpi !== null)
  })
})

describe('pharmacokinetics', () => {
  it('converts between half-life and elimination constant', () => {
    const report = ok(pharmacokinetics({ halfLife: 4 }), 'constant')
    assert.ok(Math.abs(report.eliminationConstant - Math.LN2 / 4) < 1e-15)
    const back = ok(pharmacokinetics({ eliminationConstant: Math.LN2 / 4 }), 'back')
    assert.ok(Math.abs(back.halfLife - 4) < 1e-12)
  })

  it('puts steady state at five half-lives', () => {
    const report = ok(pharmacokinetics({ halfLife: 4 }), 'steady')
    assert.equal(report.timeToSteadyState, 20)
  })

  it('doubles the level when dosing every half-life', () => {
    const report = ok(pharmacokinetics({ halfLife: 4, dosingInterval: 4 }), 'accumulate')
    assert.ok(Math.abs((report.steadyState?.accumulationFactor as number) - 2) < 1e-12)
  })

  it('multiplies by about five when dosing every quarter half-life', () => {
    const report = ok(pharmacokinetics({ halfLife: 4, dosingInterval: 1 }), 'quarter')
    assert.ok(Math.abs((report.steadyState?.accumulationFactor as number) - 1 / (1 - Math.pow(0.5, 0.25))) < 1e-12)
    assert.ok((report.steadyState?.accumulationFactor as number) > 4.5)
  })

  it('computes clearance as constant times volume', () => {
    const report = ok(pharmacokinetics({ halfLife: 4, volumeOfDistribution: 50 }), 'clearance')
    assert.ok(Math.abs((report.clearance as number) - (Math.LN2 / 4) * 50) < 1e-12)
  })

  it('names the threshold it used for "cleared"', () => {
    const report = ok(pharmacokinetics({ halfLife: 4 }), 'threshold')
    assert.equal(report.practicallyCleared.remainingFraction, 0.03)
    assert.ok(report.practicallyCleared.halfLives > 5)
  })

  it('always says first-order elimination is assumed', () => {
    const report = ok(pharmacokinetics({ halfLife: 4 }), 'first order')
    assert.ok(report.warnings.some((one) => /phenytoin/.test(one)))
  })

  it('explains a volume of distribution larger than a body', () => {
    const report = ok(pharmacokinetics({ halfLife: 4, volumeOfDistribution: 5000 }), 'huge volume')
    assert.ok(report.warnings.some((one) => /concentrates in fat/.test(one)))
  })

  it('refuses a threshold of zero, because nothing reaches zero', () => {
    const result = pharmacokinetics({ halfLife: 4, clearedThreshold: 0 })
    assert.ok(isPhysiologyError(result))
    assert.match(result.message, /Nothing ever reaches exactly zero/)
  })

  it('refuses without a half-life or a constant', () => {
    const result = pharmacokinetics({})
    assert.ok(isPhysiologyError(result))
  })
})

// ---------------------------------------------------------------- populations

describe('population growth', () => {
  it('matches the exponential solution', () => {
    const report = ok(
      populationGrowth({ model: 'exponential', initialSize: 100, growthRate: 0.1, duration: 10, steps: 4000 }),
      'exponential'
    )
    assert.ok(Math.abs(report.finalSize - 100 * Math.exp(1)) / (100 * Math.E) < 1e-6)
  })

  it('gives ln(2)/r as the doubling time', () => {
    const report = ok(
      populationGrowth({ model: 'exponential', initialSize: 100, growthRate: 0.1, duration: 10 }),
      'doubling'
    )
    assert.ok(Math.abs((report.doublingTime as number) - Math.LN2 / 0.1) < 1e-12)
  })

  it('approaches the carrying capacity under logistic growth', () => {
    const report = ok(
      populationGrowth({ model: 'logistic', initialSize: 10, growthRate: 0.5, carryingCapacity: 1000, duration: 60 }),
      'logistic'
    )
    assert.ok(Math.abs(report.finalSize - 1000) / 1000 < 1e-4)
    assert.equal(report.equilibrium, 1000)
  })

  it('never overshoots the capacity with Runge-Kutta', () => {
    const report = ok(
      populationGrowth({ model: 'logistic', initialSize: 10, growthRate: 0.5, carryingCapacity: 1000, duration: 60 }),
      'no overshoot'
    )
    assert.ok(report.trace.every((one) => one.size <= 1000.0001))
  })

  it('puts fastest logistic growth at half the capacity with rate rK/4', () => {
    const report = ok(
      populationGrowth({ model: 'logistic', initialSize: 10, growthRate: 0.5, carryingCapacity: 1000, duration: 60 }),
      'fastest'
    )
    assert.equal(report.fastestGrowthAt?.size, 500)
    assert.ok(Math.abs((report.fastestGrowthAt?.rate as number) - (0.5 * 1000) / 4) < 1e-12)
  })

  it('refuses a carrying capacity model without a capacity', () => {
    const result = populationGrowth({ model: 'logistic', initialSize: 10, growthRate: 0.5, duration: 10 })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /needs a carrying capacity/)
  })

  it('gives no doubling time for a capped model', () => {
    const report = ok(
      populationGrowth({ model: 'logistic', initialSize: 10, growthRate: 0.5, carryingCapacity: 1000, duration: 10 }),
      'no doubling'
    )
    assert.equal(report.doublingTime, null)
    assert.ok(report.warnings.some((one) => /doubling time only exists/.test(one)))
  })

  it('flags an exponential projection that has left the biology behind', () => {
    const report = ok(
      populationGrowth({ model: 'exponential', initialSize: 1, growthRate: 1, duration: 30 }),
      'runaway'
    )
    assert.equal(report.beyondMeaning, true)
    assert.ok(report.warnings.some((one) => /hitting something/.test(one)))
  })

  it('settles Beverton-Holt at the capacity', () => {
    const report = ok(
      populationGrowth({
        model: 'beverton-holt',
        initialSize: 10,
        growthRate: 0.5,
        carryingCapacity: 1000,
        duration: 200,
        steps: 200
      }),
      'beverton'
    )
    assert.ok(Math.abs(report.finalSize - 1000) / 1000 < 1e-3)
  })

  it('reports Ricker chaos as a property of the model', () => {
    const report = ok(
      populationGrowth({
        model: 'ricker',
        initialSize: 100,
        growthRate: 2.8,
        carryingCapacity: 1000,
        duration: 100,
        steps: 100
      }),
      'chaos'
    )
    assert.ok(report.warnings.some((one) => /chaotic/.test(one)))
  })

  it('lists its assumptions', () => {
    const report = ok(populationGrowth({ model: 'exponential', initialSize: 10, growthRate: 0.1, duration: 5 }), 'assumptions')
    assert.equal(report.assumptions.length, 5)
  })
})

describe('predator and prey', () => {
  it('puts the equilibrium where each population is set by the other parameters', () => {
    const report = ok(
      predatorPrey({
        prey: 40,
        predator: 9,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        duration: 100
      }),
      'equilibrium'
    )
    // Prey* = d/(c*a) = 0.3/(0.5*0.02) = 30. Predator* = r/a = 0.4/0.02 = 20.
    assert.ok(Math.abs((report.equilibrium?.prey as number) - 30) < 1e-9)
    assert.ok(Math.abs((report.equilibrium?.predator as number) - 20) < 1e-9)
  })

  it('measures a cycle period from the trace', () => {
    const report = ok(
      predatorPrey({
        prey: 40,
        predator: 9,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        duration: 200,
        steps: 40_000
      }),
      'period'
    )
    assert.ok(report.cyclePeriod !== null)
    // Small-oscillation period is 2*pi/sqrt(r*d) = 2*pi/sqrt(0.12) ~ 18.1.
    assert.ok(Math.abs((report.cyclePeriod as number) - (2 * Math.PI) / Math.sqrt(0.12)) < 4)
  })

  it('warns that the bare model cycles forever', () => {
    const report = ok(
      predatorPrey({
        prey: 40,
        predator: 9,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        duration: 50
      }),
      'neutral'
    )
    assert.ok(report.warnings.some((one) => /neutrally stable/.test(one)))
  })

  it('damps to the equilibrium with a prey capacity', () => {
    const report = ok(
      predatorPrey({
        prey: 40,
        predator: 9,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        preyCapacity: 200,
        duration: 600,
        steps: 60_000
      }),
      'damped'
    )
    assert.ok(Math.abs(report.trace[report.trace.length - 1].prey - (report.equilibrium?.prey as number)) < 1)
  })

  it('kills the predators off when they cannot break even below the prey capacity', () => {
    const report = ok(
      predatorPrey({
        prey: 20,
        predator: 5,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        preyCapacity: 20,
        duration: 200
      }),
      'starve'
    )
    assert.equal(report.equilibrium?.predator, 0)
    assert.ok(report.warnings.some((one) => /cannot sustain themselves/.test(one)))
  })

  it('refuses a predation rate of zero as not a predator-prey system', () => {
    const result = predatorPrey({
      prey: 40,
      predator: 9,
      preyGrowth: 0.4,
      predationRate: 0,
      predatorDeath: 0.3,
      conversionRate: 0.5,
      duration: 50
    })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /do not interact/)
  })

  it('lists its assumptions', () => {
    const report = ok(
      predatorPrey({
        prey: 40,
        predator: 9,
        preyGrowth: 0.4,
        predationRate: 0.02,
        predatorDeath: 0.3,
        conversionRate: 0.5,
        duration: 20
      }),
      'assumptions'
    )
    assert.equal(report.assumptions.length, 5)
  })
})

describe('mark and recapture', () => {
  it('computes the Lincoln-Petersen estimate', () => {
    const report = ok(markRecapture({ marked: 100, recaptureSample: 100, recapturedMarked: 20 }), 'lp')
    assert.equal(report.lincolnPetersen, 500)
  })

  it('gives a slightly lower Chapman estimate', () => {
    const report = ok(markRecapture({ marked: 100, recaptureSample: 100, recapturedMarked: 20 }), 'chapman')
    // 101*101/21 - 1 = 484.76.
    assert.ok(Math.abs(report.chapman - ((101 * 101) / 21 - 1)) < 1e-9)
    assert.ok(report.chapman < report.lincolnPetersen)
  })

  it('stays finite with no recaptures where Lincoln-Petersen does not', () => {
    const report = ok(markRecapture({ marked: 50, recaptureSample: 50, recapturedMarked: 0 }), 'zero')
    assert.equal(report.lincolnPetersen, Number.POSITIVE_INFINITY)
    assert.ok(Number.isFinite(report.chapman))
    assert.ok(report.warnings.some((one) => /lower bound at best/.test(one)))
  })

  it('calls a handful of recaptures unreliable', () => {
    const report = ok(markRecapture({ marked: 50, recaptureSample: 50, recapturedMarked: 3 }), 'few')
    assert.equal(report.reliable, false)
    assert.ok(report.warnings.some((one) => /at least ten/.test(one)))
  })

  it('refuses more marks back than went out', () => {
    const result = markRecapture({ marked: 10, recaptureSample: 50, recapturedMarked: 20 })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /More marks came back/)
  })

  it('refuses more marked than the second sample holds', () => {
    const result = markRecapture({ marked: 100, recaptureSample: 10, recapturedMarked: 20 })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /cannot exceed it/)
  })

  it('lists each assumption with its direction of bias', () => {
    const report = ok(markRecapture({ marked: 100, recaptureSample: 100, recapturedMarked: 20 }), 'assumptions')
    assert.equal(report.assumptions.length, 5)
    assert.ok(report.assumptions.some((one) => /inflates the estimate/.test(one)))
  })
})

describe('diversity', () => {
  const even = [
    { name: 'a', count: 25 },
    { name: 'b', count: 25 },
    { name: 'c', count: 25 },
    { name: 'd', count: 25 }
  ]

  it('gives ln(S) for a perfectly even community', () => {
    const report = ok(diversity({ counts: even }), 'even')
    assert.ok(Math.abs(report.shannon - Math.log(4)) < 1e-12)
    assert.ok(Math.abs(report.evenness - 1) < 1e-12)
  })

  it('gives 1 - 1/S for even Simpson', () => {
    const report = ok(diversity({ counts: even }), 'simpson')
    assert.ok(Math.abs(report.simpson - 0.75) < 1e-12)
    assert.ok(Math.abs(report.inverseSimpson - 4) < 1e-12)
  })

  it('makes the effective species count equal the richness when even', () => {
    const report = ok(diversity({ counts: even }), 'effective')
    assert.ok(Math.abs(report.effectiveSpecies.order1 - 4) < 1e-9)
    assert.ok(Math.abs(report.effectiveSpecies.order2 - 4) < 1e-9)
  })

  it('gives zero diversity for one species', () => {
    const report = ok(diversity({ counts: [{ name: 'a', count: 100 }] }), 'single')
    assert.equal(report.shannon, 0)
    assert.equal(report.simpson, 0)
    assert.equal(report.evenness, 1)
  })

  it('drops below the richness when one species dominates', () => {
    const report = ok(
      diversity({
        counts: [
          { name: 'a', count: 97 },
          { name: 'b', count: 1 },
          { name: 'c', count: 1 },
          { name: 'd', count: 1 }
        ]
      }),
      'uneven'
    )
    assert.equal(report.richness, 4)
    assert.ok(report.effectiveSpecies.order2 < 1.1)
    assert.ok(Math.abs(report.bergerParker - 0.97) < 1e-12)
  })

  it('estimates missed species from singletons', () => {
    const report = ok(
      diversity({
        counts: [
          { name: 'a', count: 50 },
          { name: 'b', count: 20 },
          { name: 'c', count: 2 },
          { name: 'd', count: 1 },
          { name: 'e', count: 1 }
        ]
      }),
      'chao1'
    )
    // 2 singletons, 1 doubleton: unseen = 4/2 = 2.
    assert.ok(Math.abs((report.chao1?.unseenEstimate as number) - 2) < 1e-12)
    assert.ok(Math.abs((report.chao1?.estimate as number) - 7) < 1e-12)
  })

  it('skips Chao1 for fractional counts and says why', () => {
    const report = ok(
      diversity({
        counts: [
          { name: 'a', count: 25.5 },
          { name: 'b', count: 30.2 }
        ]
      }),
      'fractional'
    )
    assert.equal(report.chao1, null)
    assert.ok(report.warnings.some((one) => /fractional count/.test(one)))
  })

  it('refuses a species listed twice', () => {
    const result = diversity({
      counts: [
        { name: 'a', count: 5 },
        { name: 'A', count: 5 }
      ]
    })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /appears twice/)
  })

  it('warns when most species are singletons', () => {
    const report = ok(
      diversity({
        counts: [
          { name: 'a', count: 5 },
          { name: 'b', count: 1 },
          { name: 'c', count: 1 },
          { name: 'd', count: 1 }
        ]
      }),
      'singletons'
    )
    assert.ok(report.warnings.some((one) => /most of the community was not sampled/.test(one)))
  })

  it('shares sum to one', () => {
    const report = ok(diversity({ counts: even }), 'shares')
    assert.ok(Math.abs(report.shares.reduce((sum, one) => sum + one.share, 0) - 1) < 1e-12)
  })
})

describe('food chains', () => {
  it('applies ten percent per step by default', () => {
    const report = ok(foodChain({ primaryProduction: 10_000, levels: 4 }), 'ten percent')
    assert.ok(Math.abs(report.levels[3].energy - 10) < 1e-9)
    assert.ok(Math.abs(report.baseRequired - 1000) < 1e-9)
  })

  it('says the ten percent rule is a rule of thumb, not a law', () => {
    const report = ok(foodChain({ primaryProduction: 100, levels: 3 }), 'rule')
    assert.ok(report.warnings.some((one) => /rule of thumb/.test(one)))
  })

  it('takes a different efficiency per step', () => {
    const report = ok(foodChain({ primaryProduction: 1000, levels: 3, efficiency: [0.2, 0.1] }), 'per step')
    assert.ok(Math.abs(report.levels[2].energy - 1000 * 0.2 * 0.1) < 1e-9)
    assert.ok(Math.abs(report.baseRequired - 50) < 1e-9)
  })

  it('refuses an efficiency above one', () => {
    const result = foodChain({ primaryProduction: 1000, levels: 3, efficiency: 1.5 })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /more energy than it ate/)
  })

  it('refuses too few efficiencies for the levels asked for', () => {
    const result = foodChain({ primaryProduction: 1000, levels: 4, efficiency: [0.1] })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /3 transfer efficiencies/)
  })

  it('warns above five levels', () => {
    const report = ok(foodChain({ primaryProduction: 1e9, levels: 7 }), 'too many')
    assert.ok(report.warnings.some((one) => /rarely exceed five/.test(one)))
  })

  it('says the lost energy went into respiration rather than being wasted', () => {
    const report = ok(foodChain({ primaryProduction: 1000, levels: 3 }), 'respiration')
    assert.ok(report.notes.some((one) => /respiration/.test(one)))
  })
})

describe('life tables', () => {
  const cohort = [
    { age: 0, survivors: 1000, fecundity: 0 },
    { age: 1, survivors: 500, fecundity: 2 },
    { age: 2, survivors: 200, fecundity: 3 },
    { age: 3, survivors: 0, fecundity: 0 }
  ]

  it('computes the net reproductive rate as the sum of survivorship times fecundity', () => {
    const report = ok(lifeTable({ rows: cohort }), 'r0')
    // 0.5*2 + 0.2*3 = 1.6.
    assert.ok(Math.abs(report.netReproductiveRate - 1.6) < 1e-12)
    assert.equal(report.replacing, true)
  })

  it('computes generation time as the fecundity-weighted mean age', () => {
    const report = ok(lifeTable({ rows: cohort }), 'T')
    // (1*1.0 + 2*0.6) / 1.6 = 2.2/1.6 = 1.375.
    assert.ok(Math.abs(report.generationTime - 1.375) < 1e-12)
  })

  it('solves the Euler-Lotka equation rather than approximating', () => {
    const report = ok(lifeTable({ rows: cohort }), 'r')
    const check = report.rows.reduce(
      (sum, row) => sum + Math.exp(-report.intrinsicRate * row.age) * row.survivorship * row.fecundity,
      0
    )
    assert.ok(Math.abs(check - 1) < 1e-8)
  })

  it('differs from the ln(R0)/T approximation and says so', () => {
    const report = ok(lifeTable({ rows: cohort }), 'approximation')
    const approximation = Math.log(report.netReproductiveRate) / report.generationTime
    assert.ok(Math.abs(report.intrinsicRate - approximation) > 1e-6)
  })

  it('identifies a type III survivorship curve', () => {
    const report = ok(
      lifeTable({
        rows: [
          { age: 0, survivors: 1000, fecundity: 0 },
          { age: 1, survivors: 100, fecundity: 2 },
          { age: 2, survivors: 20, fecundity: 4 },
          { age: 3, survivors: 0, fecundity: 0 }
        ]
      }),
      'type III'
    )
    assert.match(report.survivorshipType, /Type III/)
  })

  it('identifies a type I survivorship curve', () => {
    const report = ok(
      lifeTable({
        rows: [
          { age: 0, survivors: 1000, fecundity: 0 },
          { age: 1, survivors: 990, fecundity: 1 },
          { age: 2, survivors: 900, fecundity: 1 },
          { age: 3, survivors: 0, fecundity: 0 }
        ]
      }),
      'type I'
    )
    assert.match(report.survivorshipType, /Type I:/)
  })

  it('calls constant proportional mortality type II rather than type III', () => {
    // Half die in every class. Far more individuals die early simply because more are alive, and counting bodies
    // instead of rates would call this Type III.
    const report = ok(
      lifeTable({
        rows: [
          { age: 0, survivors: 1000, fecundity: 0 },
          { age: 1, survivors: 500, fecundity: 1 },
          { age: 2, survivors: 250, fecundity: 1 },
          { age: 3, survivors: 125, fecundity: 1 }
        ]
      }),
      'type II'
    )
    assert.match(report.survivorshipType, /Type II/)
  })

  it('warns about a rate just below replacement', () => {
    const report = ok(
      lifeTable({
        rows: [
          { age: 0, survivors: 1000, fecundity: 0 },
          { age: 1, survivors: 500, fecundity: 1.6 },
          { age: 2, survivors: 0, fecundity: 0 }
        ]
      }),
      'below'
    )
    assert.ok(Math.abs(report.netReproductiveRate - 0.8) < 1e-12)
    assert.equal(report.replacing, false)
    assert.ok(report.warnings.some((one) => /halves the population/.test(one)))
  })

  it('refuses a cohort that gains members', () => {
    const result = lifeTable({
      rows: [
        { age: 0, survivors: 100, fecundity: 0 },
        { age: 1, survivors: 200, fecundity: 1 }
      ]
    })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /does not gain members/)
  })

  it('refuses ages out of order', () => {
    const result = lifeTable({
      rows: [
        { age: 2, survivors: 100, fecundity: 0 },
        { age: 1, survivors: 50, fecundity: 1 }
      ]
    })
    assert.ok(isEcologyError(result))
  })

  it('refuses a cohort with no reproduction at all', () => {
    const result = lifeTable({
      rows: [
        { age: 0, survivors: 100, fecundity: 0 },
        { age: 1, survivors: 50, fecundity: 0 }
      ]
    })
    assert.ok(isEcologyError(result))
    assert.match(result.message, /survivorship curve rather than/)
  })

  it('warns when the cohort was not followed to the end', () => {
    const report = ok(
      lifeTable({
        rows: [
          { age: 0, survivors: 1000, fecundity: 0 },
          { age: 1, survivors: 500, fecundity: 2 }
        ]
      }),
      'truncated'
    )
    assert.ok(report.warnings.some((one) => /not followed to the end/.test(one)))
  })
})
