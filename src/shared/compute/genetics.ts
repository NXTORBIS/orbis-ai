/**
 * Genetics: sequences, the code that reads them, and how traits move between generations.
 *
 * The shared genetics engine for Orbis Pages. Sequences are validated character by character, translation uses the
 * real codon table with the reading frame stated, and every inheritance result says which model it assumed — because
 * almost nothing inherits as simply as a Punnett square suggests, and the square is still worth computing.
 *
 * ## Why the reading frame is always stated
 *
 * A DNA sequence has three reading frames in each direction, and translating the wrong one gives a completely
 * different protein rather than a slightly wrong one. Every translation says which frame it used and what the others
 * would give, because "the protein this codes for" is not a well-defined question without it.
 *
 * ## Why a Punnett square comes with its assumptions
 *
 * A single-gene Mendelian ratio assumes complete dominance, no linkage, no epistasis, equal survival of every
 * genotype, and a large enough sample for the ratio to show. Most real traits break at least one, and the
 * predictions are still the right starting point. The assumptions are listed on the result rather than left to be
 * remembered.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * DNA           vs  RNA             -- thymine against uracil, and a sequence with both is neither
 * gene          vs  allele          -- the locus against the version of it
 * genotype      vs  phenotype       -- what is carried against what shows
 * dominant      vs  common          -- what masks the other against what most people have
 * heterozygous  vs  carrier         -- the genotype against what it means for a recessive condition
 * probability   vs  ratio           -- what one offspring faces against what a large family averages to
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface GeneticsError {
  error: 'invalid-argument' | 'bad-sequence' | 'out-of-range' | 'no-solution' | 'too-long' | 'too-many' | 'ambiguous'
  message: string
}

export const isGeneticsError = (value: unknown): value is GeneticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: GeneticsError['error'], message: string): GeneticsError => ({ error, message })

export const GENETICS_LIMITS = Object.freeze({ bases: 200_000, genes: 6, alleles: 8, generations: 500 })

// ---------------------------------------------------------------- sequences

export type SequenceKind = 'dna' | 'rna'

/** The standard genetic code. Held as data because it is a table, not a rule. */
export const CODON_TABLE: Readonly<Record<string, string>> = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M', GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*', CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R', GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
})

export const CODON_TABLE_SOURCE =
  'The standard genetic code, NCBI translation table 1. Mitochondria and several groups of organisms use variant tables where some codons mean something else — most notably TGA, which is a stop codon here and tryptophan in vertebrate mitochondria.'

export const AMINO_ACIDS: Readonly<Record<string, { name: string; threeLetter: string; polarity: string; molecularWeight: number }>> =
  Object.freeze({
    A: { name: 'Alanine', threeLetter: 'Ala', polarity: 'nonpolar', molecularWeight: 89.09 },
    R: { name: 'Arginine', threeLetter: 'Arg', polarity: 'basic', molecularWeight: 174.2 },
    N: { name: 'Asparagine', threeLetter: 'Asn', polarity: 'polar', molecularWeight: 132.12 },
    D: { name: 'Aspartic acid', threeLetter: 'Asp', polarity: 'acidic', molecularWeight: 133.1 },
    C: { name: 'Cysteine', threeLetter: 'Cys', polarity: 'polar', molecularWeight: 121.16 },
    E: { name: 'Glutamic acid', threeLetter: 'Glu', polarity: 'acidic', molecularWeight: 147.13 },
    Q: { name: 'Glutamine', threeLetter: 'Gln', polarity: 'polar', molecularWeight: 146.15 },
    G: { name: 'Glycine', threeLetter: 'Gly', polarity: 'nonpolar', molecularWeight: 75.07 },
    H: { name: 'Histidine', threeLetter: 'His', polarity: 'basic', molecularWeight: 155.16 },
    I: { name: 'Isoleucine', threeLetter: 'Ile', polarity: 'nonpolar', molecularWeight: 131.17 },
    L: { name: 'Leucine', threeLetter: 'Leu', polarity: 'nonpolar', molecularWeight: 131.17 },
    K: { name: 'Lysine', threeLetter: 'Lys', polarity: 'basic', molecularWeight: 146.19 },
    M: { name: 'Methionine', threeLetter: 'Met', polarity: 'nonpolar', molecularWeight: 149.21 },
    F: { name: 'Phenylalanine', threeLetter: 'Phe', polarity: 'nonpolar', molecularWeight: 165.19 },
    P: { name: 'Proline', threeLetter: 'Pro', polarity: 'nonpolar', molecularWeight: 115.13 },
    S: { name: 'Serine', threeLetter: 'Ser', polarity: 'polar', molecularWeight: 105.09 },
    T: { name: 'Threonine', threeLetter: 'Thr', polarity: 'polar', molecularWeight: 119.12 },
    W: { name: 'Tryptophan', threeLetter: 'Trp', polarity: 'nonpolar', molecularWeight: 204.23 },
    Y: { name: 'Tyrosine', threeLetter: 'Tyr', polarity: 'polar', molecularWeight: 181.19 },
    V: { name: 'Valine', threeLetter: 'Val', polarity: 'nonpolar', molecularWeight: 117.15 },
    '*': { name: 'Stop', threeLetter: 'Ter', polarity: 'none', molecularWeight: 0 }
  })

export interface SequenceReport {
  kind: SequenceKind
  /** The sequence, uppercased and stripped of whitespace. */
  sequence: string
  length: number
  /** Each base and how often it appears. */
  composition: readonly { base: string; count: number; fraction: number }[]
  /** The fraction that is guanine or cytosine, which sets the melting temperature. */
  gcContent: number
  /** °C. Estimated melting temperature, with the method named. */
  meltingTemperature: number
  meltingMethod: string
  /** The reverse complement, which is the other strand read the way it is read. */
  reverseComplement: string
  /** Whether the sequence reads the same as its own reverse complement — a restriction site pattern. */
  isPalindromic: boolean
  /** Any ambiguity codes present, which are real and are not errors. */
  ambiguousBases: readonly { base: string; meaning: string; count: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

const AMBIGUITY: Readonly<Record<string, string>> = Object.freeze({
  R: 'A or G (purine)', Y: 'C or T (pyrimidine)', S: 'G or C', W: 'A or T',
  K: 'G or T', M: 'A or C', B: 'not A', D: 'not C', H: 'not G', V: 'not T', N: 'any base'
})

const COMPLEMENT: Readonly<Record<string, string>> = Object.freeze({
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D'
})

/**
 * Read and describe a nucleic acid sequence.
 *
 * A sequence containing both thymine and uracil is refused rather than guessed at: it is neither DNA nor RNA, and
 * every downstream calculation would be wrong in a way that is hard to notice. Ambiguity codes are recognised as
 * real rather than treated as errors, because a real sequence from a real instrument contains them.
 *
 * The melting temperature uses the nearest-neighbour-free approximation appropriate to the length, and says which:
 * the simple GC rule is adequate above about fifty bases and badly wrong for a short primer, where the base
 * composition at the ends matters.
 */
export function readSequence(input: { sequence: string; kind?: SequenceKind }): SequenceReport | GeneticsError {
  if (typeof input.sequence !== 'string') return fail('invalid-argument', 'A sequence has to be text.')
  const cleaned = input.sequence.replace(/[\s\d>]/g, '').toUpperCase()
  if (cleaned.length === 0) return fail('bad-sequence', 'There is no sequence here once whitespace and numbering are removed.')
  if (cleaned.length > GENETICS_LIMITS.bases) {
    return fail('too-long', `That is ${cleaned.length} bases; this handles up to ${GENETICS_LIMITS.bases}.`)
  }

  const valid = new Set(['A', 'C', 'G', 'T', 'U', ...Object.keys(AMBIGUITY)])
  for (let i = 0; i < cleaned.length; i += 1) {
    if (!valid.has(cleaned[i])) {
      return fail(
        'bad-sequence',
        `"${cleaned[i]}" at position ${i + 1} is not a nucleotide. Valid letters are A, C, G, T, U and the IUPAC ambiguity codes ${Object.keys(AMBIGUITY).join(', ')}.`
      )
    }
  }

  const hasT = cleaned.includes('T')
  const hasU = cleaned.includes('U')
  if (hasT && hasU) {
    return fail(
      'ambiguous',
      'This sequence contains both thymine and uracil, so it is neither DNA nor RNA. That is almost always a transcription error or two sequences concatenated, and every calculation downstream of it would be wrong in a way nobody notices.'
    )
  }
  const kind: SequenceKind = input.kind ?? (hasU ? 'rna' : 'dna')
  const warnings: string[] = []
  if (input.kind === 'dna' && hasU) warnings.push('This was labelled DNA and contains uracil, which DNA does not.')
  if (input.kind === 'rna' && hasT) warnings.push('This was labelled RNA and contains thymine, which RNA does not.')

  const counts = new Map<string, number>()
  for (const base of cleaned) counts.set(base, (counts.get(base) ?? 0) + 1)
  const composition = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([base, count]) => ({ base, count, fraction: count / cleaned.length }))

  const gc = ((counts.get('G') ?? 0) + (counts.get('C') ?? 0)) / cleaned.length
  const ambiguousCount = [...counts.entries()].filter(([base]) => base in AMBIGUITY).reduce((sum, [, count]) => sum + count, 0)
  if (ambiguousCount > 0) {
    warnings.push(
      `${ambiguousCount} of ${cleaned.length} positions are ambiguity codes. They are legitimate and they make the GC content and melting temperature approximate — a run of N could be anything.`
    )
  }

  // The melting temperature. Which formula applies depends on the length, and the difference is large for a primer.
  let meltingTemperature: number
  let meltingMethod: string
  if (cleaned.length < 14) {
    const gcCount = (counts.get('G') ?? 0) + (counts.get('C') ?? 0)
    const atCount = (counts.get('A') ?? 0) + (counts.get('T') ?? 0) + (counts.get('U') ?? 0)
    meltingTemperature = (atCount * 2 + gcCount * 4)
    meltingMethod = 'The Wallace rule: 2 C per A or T and 4 C per G or C. Only valid below about 14 bases, and it ignores everything about the sequence order.'
  } else if (cleaned.length < 50) {
    meltingTemperature = 64.9 + 41 * (gc - 16.4 / cleaned.length)
    meltingMethod =
      'The salt-adjusted formula for 14 to 50 bases at standard conditions. A nearest-neighbour calculation is more accurate and needs thermodynamic tables this does not carry.'
  } else {
    meltingTemperature = 81.5 + 16.6 * Math.log10(0.05) + 41 * gc - 500 / cleaned.length
    meltingMethod = 'The long-sequence formula at 50 mM salt. Adequate above 50 bases, where the end effects stop dominating.'
  }

  const reverseComplement = [...cleaned]
    .reverse()
    .map((base) => COMPLEMENT[base] ?? 'N')
    .join('')

  return {
    kind,
    sequence: cleaned,
    length: cleaned.length,
    composition: Object.freeze(composition),
    gcContent: gc,
    meltingTemperature,
    meltingMethod,
    reverseComplement,
    isPalindromic: cleaned === reverseComplement,
    ambiguousBases: Object.freeze(
      [...counts.entries()]
        .filter(([base]) => base in AMBIGUITY)
        .map(([base, count]) => ({ base, meaning: AMBIGUITY[base], count }))
    ),
    notes: Object.freeze([
      `${cleaned.length} bases of ${kind.toUpperCase()}, ${(gc * 100).toFixed(2)}% GC.`,
      `Estimated melting temperature ${meltingTemperature.toFixed(1)} C. ${meltingMethod}`,
      'GC content sets the melting temperature because a G-C pair has three hydrogen bonds and an A-T pair has two. That is also why thermophiles have GC-rich genomes.',
      cleaned === reverseComplement
        ? 'This sequence is its own reverse complement, which is the pattern most restriction enzymes recognise — they bind the same site on both strands.'
        : 'The reverse complement is what the other strand reads, in the direction it is read. Reversing without complementing, or the other way round, is the classic mistake here.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface TranslationReport {
  /** The frame used: 1, 2 or 3 forward, or -1, -2, -3 on the reverse strand. */
  frame: number
  /** The amino acid sequence in single-letter code. */
  protein: string
  /** Each codon and what it codes for. */
  codons: readonly { position: number; codon: string; aminoAcid: string; name: string }[]
  /** The longest run without a stop codon, which is what an open reading frame is. */
  longestOpenReadingFrame: { from: number; to: number; length: number; protein: string } | null
  /** Whether the frame starts with a start codon and ends with a stop. */
  startsWithMethionine: boolean
  endsWithStop: boolean
  /** What every other frame would give, since "the protein" is not well defined without one. */
  otherFrames: readonly { frame: number; protein: string; stops: number; longestRun: number }[]
  /** Daltons, for the translated protein. */
  molecularWeight: number
  source: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Translate a sequence in a stated frame, with what the other frames would give.
 *
 * The other frames are the point. A DNA sequence has six reading frames and translating the wrong one gives an
 * unrelated protein rather than a slightly wrong one — so "the protein this codes for" is not a well-defined question
 * until the frame is fixed. The frame with the longest run free of stop codons is usually the real one, and that
 * comparison is what this makes visible.
 */
export function translate(input: { sequence: string; frame?: number }): TranslationReport | GeneticsError {
  const read = readSequence({ sequence: input.sequence })
  if (isGeneticsError(read)) return read
  const frame = Math.round(input.frame ?? 1)
  if (![1, 2, 3, -1, -2, -3].includes(frame)) {
    return fail(
      'invalid-argument',
      'The frame is 1, 2 or 3 on the forward strand, or -1, -2 or -3 on the reverse. A sequence has six reading frames and translating the wrong one gives an unrelated protein.'
    )
  }

  // Work in DNA letters so one codon table covers both.
  const asDna = read.sequence.replace(/U/g, 'T')
  const strandFor = (which: number): string =>
    which > 0 ? asDna : [...asDna].reverse().map((base) => COMPLEMENT[base] ?? 'N').join('')

  const translateFrame = (which: number): { protein: string; codons: TranslationReport['codons'][number][] } => {
    const strand = strandFor(which)
    const offset = Math.abs(which) - 1
    const codons: TranslationReport['codons'][number][] = []
    let protein = ''
    for (let i = offset; i + 3 <= strand.length; i += 3) {
      const codon = strand.slice(i, i + 3)
      const amino = Object.prototype.hasOwnProperty.call(CODON_TABLE, codon) ? CODON_TABLE[codon] : 'X'
      protein += amino
      codons.push({
        position: codons.length + 1,
        codon,
        aminoAcid: amino,
        name: amino === 'X' ? 'unknown, because the codon contains an ambiguity code' : AMINO_ACIDS[amino].name
      })
    }
    return { protein, codons }
  }

  const main = translateFrame(frame)
  const warnings: string[] = []
  if (main.codons.length === 0) {
    return fail('bad-sequence', `Frame ${frame} leaves fewer than three bases, so there is nothing to translate.`)
  }

  const runsOf = (protein: string): { from: number; to: number; length: number; protein: string } | null => {
    let best: { from: number; to: number; length: number; protein: string } | null = null
    let start = 0
    for (let i = 0; i <= protein.length; i += 1) {
      if (i === protein.length || protein[i] === '*') {
        const length = i - start
        if (best === null || length > best.length) {
          best = { from: start + 1, to: i, length, protein: protein.slice(start, i) }
        }
        start = i + 1
      }
    }
    return best !== null && best.length > 0 ? best : null
  }

  const otherFrames = [1, 2, 3, -1, -2, -3]
    .filter((one) => one !== frame)
    .map((one) => {
      const built = translateFrame(one)
      const run = runsOf(built.protein)
      return {
        frame: one,
        protein: built.protein,
        stops: [...built.protein].filter((c) => c === '*').length,
        longestRun: run?.length ?? 0
      }
    })

  const longest = runsOf(main.protein)
  const bestOther = otherFrames.reduce((best, one) => (one.longestRun > best.longestRun ? one : best), {
    frame,
    protein: main.protein,
    stops: 0,
    longestRun: longest?.length ?? 0
  })
  if (bestOther.frame !== frame && bestOther.longestRun > (longest?.length ?? 0) * 1.5) {
    warnings.push(
      `Frame ${bestOther.frame} has a stop-free run of ${bestOther.longestRun} residues against ${longest?.length ?? 0} in frame ${frame}. The frame with the longest open run is usually the real one, so this may be the wrong frame.`
    )
  }
  if (read.ambiguousBases.length > 0) {
    warnings.push('The sequence contains ambiguity codes, so some codons translate to X rather than to an amino acid.')
  }

  // Molecular weight: the residues less one water per peptide bond.
  const residues = [...main.protein].filter((one) => one !== '*' && one !== 'X')
  const weight =
    residues.length === 0 ? 0 : residues.reduce((sum, one) => sum + AMINO_ACIDS[one].molecularWeight, 0) - (residues.length - 1) * 18.015

  return {
    frame,
    protein: main.protein,
    codons: Object.freeze(main.codons),
    longestOpenReadingFrame: longest,
    startsWithMethionine: main.protein.startsWith('M'),
    endsWithStop: main.protein.endsWith('*'),
    otherFrames: Object.freeze(otherFrames),
    molecularWeight: weight,
    source: CODON_TABLE_SOURCE,
    notes: Object.freeze([
      `Frame ${frame}: ${main.protein.length} codons giving ${residues.length} residues, about ${weight.toFixed(1)} Da.`,
      'The other five frames are reported because a sequence has six of them and the wrong one gives an unrelated protein rather than a slightly wrong one.',
      longest === null
        ? 'No stop-free run was found.'
        : `The longest open run is ${longest.length} residues, from codon ${longest.from} to ${longest.to}. A long run free of stops is the signature of a real coding sequence, since a random sequence hits a stop about every 21 codons.`,
      CODON_TABLE_SOURCE
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- Mendelian inheritance

export interface CrossReport {
  /** Each parent's genotype, as given. */
  parents: readonly string[]
  /** Every offspring genotype and its probability. */
  genotypes: readonly { genotype: string; probability: number; count: number }[]
  /** Every phenotype and its probability, under the dominance stated. */
  phenotypes: readonly { phenotype: string; probability: number; genotypes: readonly string[] }[]
  /** The ratio in whole numbers, which is what a textbook quotes. */
  genotypeRatio: string
  phenotypeRatio: string
  /** How many genes are being tracked. */
  genes: number
  /** The Punnett square itself, for drawing. */
  square: readonly { fromFirst: string; fromSecond: string; genotype: string }[]
  assumptions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A Punnett square for one or more genes, with the assumptions it rests on listed.
 *
 * The assumptions are not a formality. A 9:3:3:1 dihybrid ratio requires the two genes to be on different chromosomes
 * or far apart on the same one; linked genes give a completely different ratio and the square gives no hint of it.
 * Every result lists what had to be true for it to hold.
 *
 * The probabilities are per offspring. A ratio is what a large family averages to, and a family of four has a
 * reasonable chance of showing none of the recessive phenotype at all — which is a different statement and the one
 * people actually need.
 */
export function cross(input: {
  /** Genotypes like "Aa" or "AaBb". Uppercase is dominant, lowercase recessive. */
  first: string
  second: string
  /** Traits that are not simply dominant. */
  incompleteDominance?: boolean
  codominance?: boolean
}): CrossReport | GeneticsError {
  const parse = (genotype: string, which: string): string[][] | GeneticsError => {
    const cleaned = genotype.replace(/\s/g, '')
    if (cleaned.length === 0) return fail('invalid-argument', `The ${which} genotype is empty.`)
    if (cleaned.length % 2 !== 0) {
      return fail(
        'invalid-argument',
        `"${genotype}" has an odd number of letters, so one gene has only one allele. A diploid genotype has two alleles per gene — "Aa" not "A".`
      )
    }
    const genes: string[][] = []
    for (let i = 0; i < cleaned.length; i += 2) {
      const a = cleaned[i]
      const b = cleaned[i + 1]
      if (!/[A-Za-z]/.test(a) || !/[A-Za-z]/.test(b)) {
        return fail('invalid-argument', `"${genotype}" contains something that is not a letter.`)
      }
      if (a.toLowerCase() !== b.toLowerCase()) {
        return fail(
          'invalid-argument',
          `"${a}${b}" pairs two different genes. The two alleles of one gene use the same letter in different cases, like "Aa" — "Ab" would be one allele each of two genes and is not a pair.`
        )
      }
      genes.push([a, b])
    }
    return genes
  }

  const firstGenes = parse(input.first, 'first')
  if (isGeneticsError(firstGenes)) return firstGenes
  const secondGenes = parse(input.second, 'second')
  if (isGeneticsError(secondGenes)) return secondGenes

  if (firstGenes.length !== secondGenes.length) {
    return fail(
      'invalid-argument',
      `The first parent has ${firstGenes.length} gene${firstGenes.length === 1 ? '' : 's'} and the second has ${secondGenes.length}. A cross tracks the same genes in both parents.`
    )
  }
  if (firstGenes.length > GENETICS_LIMITS.genes) {
    return fail('too-many', `That is ${firstGenes.length} genes, giving ${Math.pow(4, firstGenes.length)} squares; this handles up to ${GENETICS_LIMITS.genes}.`)
  }
  for (const [i, gene] of firstGenes.entries()) {
    if (gene[0].toLowerCase() !== secondGenes[i][0].toLowerCase()) {
      return fail('invalid-argument', `Gene ${i + 1} is "${gene.join('')}" in one parent and "${secondGenes[i].join('')}" in the other. They have to be the same gene.`)
    }
  }

  // Every gamete from each parent, as a list of allele choices per gene.
  const gametesOf = (genes: string[][]): string[] => {
    let combos: string[] = ['']
    for (const gene of genes) {
      const next: string[] = []
      for (const combo of combos) for (const allele of gene) next.push(combo + allele)
      combos = next
    }
    return combos
  }
  const firstGametes = gametesOf(firstGenes)
  const secondGametes = gametesOf(secondGenes)

  // Sort each gene's pair so Aa and aA are the same genotype.
  const normalise = (gamete1: string, gamete2: string): string => {
    let out = ''
    for (let i = 0; i < gamete1.length; i += 1) {
      const pair = [gamete1[i], gamete2[i]].sort((a, b) => {
        // Uppercase first, which is the convention.
        if (a.toLowerCase() !== b.toLowerCase()) return a.toLowerCase().localeCompare(b.toLowerCase())
        return a === a.toUpperCase() ? -1 : 1
      })
      out += pair.join('')
    }
    return out
  }

  const square: CrossReport['square'][number][] = []
  const genotypeCounts = new Map<string, number>()
  for (const a of firstGametes) {
    for (const b of secondGametes) {
      const genotype = normalise(a, b)
      square.push({ fromFirst: a, fromSecond: b, genotype })
      genotypeCounts.set(genotype, (genotypeCounts.get(genotype) ?? 0) + 1)
    }
  }
  const total = square.length

  // The phenotype: dominant if any uppercase allele is present, unless the trait is not simply dominant.
  const phenotypeOf = (genotype: string): string => {
    const parts: string[] = []
    for (let i = 0; i < genotype.length; i += 2) {
      const a = genotype[i]
      const b = genotype[i + 1]
      const letter = a.toLowerCase()
      const dominantCount = [a, b].filter((one) => one === one.toUpperCase()).length
      if (input.codominance === true) {
        parts.push(dominantCount === 2 ? `${letter.toUpperCase()}${letter.toUpperCase()}` : dominantCount === 1 ? `both ${letter.toUpperCase()} and ${letter}` : `${letter}${letter}`)
      } else if (input.incompleteDominance === true) {
        parts.push(dominantCount === 2 ? `full ${letter.toUpperCase()}` : dominantCount === 1 ? `intermediate ${letter}` : `no ${letter.toUpperCase()}`)
      } else {
        parts.push(dominantCount > 0 ? `${letter.toUpperCase()} dominant` : `${letter} recessive`)
      }
    }
    return parts.join(', ')
  }

  const phenotypeGroups = new Map<string, { count: number; genotypes: Set<string> }>()
  for (const [genotype, count] of genotypeCounts) {
    const phenotype = phenotypeOf(genotype)
    const group = phenotypeGroups.get(phenotype) ?? { count: 0, genotypes: new Set<string>() }
    group.count += count
    group.genotypes.add(genotype)
    phenotypeGroups.set(phenotype, group)
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const ratioOf = (counts: readonly number[]): string => {
    const divisor = counts.reduce((current, one) => gcd(current, one))
    return counts.map((one) => one / divisor).join(':')
  }

  const genotypes = [...genotypeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([genotype, count]) => ({ genotype, probability: count / total, count }))
  const phenotypes = [...phenotypeGroups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([phenotype, group]) => ({
      phenotype,
      probability: group.count / total,
      genotypes: Object.freeze([...group.genotypes].sort())
    }))

  const warnings: string[] = []
  if (firstGenes.length > 1) {
    warnings.push(
      `This assumes the ${firstGenes.length} genes assort independently — different chromosomes, or far enough apart on one. Linked genes give a completely different ratio and a Punnett square gives no hint of it.`
    )
  }
  const recessiveOnly = phenotypes.find((one) => one.probability === 1 / total)
  if (recessiveOnly !== undefined && total >= 4) {
    const chanceOfNone = Math.pow(1 - recessiveOnly.probability, 4)
    warnings.push(
      `The rarest phenotype has a probability of ${recessiveOnly.probability.toFixed(4)} per offspring. In a family of four there is a ${(chanceOfNone * 100).toFixed(1)}% chance of seeing none of it at all — a ratio is what a large sample averages to, not what a family shows.`
    )
  }

  return {
    parents: Object.freeze([input.first, input.second]),
    genotypes: Object.freeze(genotypes),
    phenotypes: Object.freeze(phenotypes),
    genotypeRatio: ratioOf(genotypes.map((one) => one.count)),
    phenotypeRatio: ratioOf(phenotypes.map((one) => Math.round(one.probability * total))),
    genes: firstGenes.length,
    square: Object.freeze(square),
    assumptions: Object.freeze([
      input.incompleteDominance === true || input.codominance === true
        ? 'The trait was treated as not simply dominant, as asked.'
        : 'Complete dominance: one copy of the uppercase allele gives the dominant phenotype. Incomplete dominance and codominance give three phenotypes instead of two.',
      firstGenes.length > 1
        ? 'Independent assortment: the genes are on different chromosomes, or far enough apart to recombine freely.'
        : 'One gene, so assortment does not arise.',
      'Every genotype survives equally. A lethal allele changes the observed ratio without changing this square — a 1:2:1 becomes an apparent 2:1.',
      'No epistasis: no other gene masks this one.',
      'A large enough sample for the ratio to show. These are probabilities per offspring.'
    ]),
    notes: Object.freeze([
      `${input.first} x ${input.second}: ${genotypes.length} genotype${genotypes.length === 1 ? '' : 's'} in ${ratioOf(genotypes.map((one) => one.count))}, ${phenotypes.length} phenotype${phenotypes.length === 1 ? '' : 's'} in ${ratioOf(phenotypes.map((one) => Math.round(one.probability * total)))}.`,
      `${total} square${total === 1 ? '' : 's'} from ${firstGametes.length} and ${secondGametes.length} gamete types.`,
      'The probabilities are per offspring. A ratio describes a large family and says nothing about a small one, which is where most confusion about inheritance comes from.',
      'Genotype is what is carried and phenotype is what shows. A carrier of a recessive condition is heterozygous and unaffected, and those are two facts rather than one.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface HardyWeinbergReport {
  /** The allele frequencies. */
  dominantFrequency: number
  recessiveFrequency: number
  /** The genotype frequencies expected at equilibrium. */
  expected: { homozygousDominant: number; heterozygous: number; homozygousRecessive: number }
  /** The observed counts, when they were given. */
  observed: { homozygousDominant: number; heterozygous: number; homozygousRecessive: number } | null
  /** The chi-square statistic against the expectation, with one degree of freedom. */
  chiSquare: number | null
  /** Whether the population is consistent with equilibrium, at the 5% level. */
  atEquilibrium: boolean | null
  /** How many carriers there are, which is the figure that surprises people. */
  carrierFrequency: number
  /** How many carriers per affected individual. */
  carriersPerAffected: number
  conditions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Hardy-Weinberg genotype frequencies, and whether an observed population matches them.
 *
 * The carrier count is the useful output and it is consistently surprising: for a recessive condition affecting one
 * in ten thousand, about one person in fifty carries it — two hundred carriers for every affected person. That ratio
 * is 2q/q² = 2/q, and it is why recessive conditions persist in a population that selects against them.
 *
 * A population out of equilibrium is more interesting than one in it, because the five conditions are what fails:
 * selection, mutation, migration, non-random mating, or a small population. The test says which is worth looking for
 * rather than only that something is wrong.
 */
export function hardyWeinberg(input: {
  /** One of these fixes the frequencies. */
  recessiveFrequency?: number
  affectedFraction?: number
  /** Observed counts, to test against the expectation. */
  observedHomozygousDominant?: number
  observedHeterozygous?: number
  observedHomozygousRecessive?: number
}): HardyWeinbergReport | GeneticsError {
  let q: number
  const observedGiven =
    input.observedHomozygousDominant !== undefined &&
    input.observedHeterozygous !== undefined &&
    input.observedHomozygousRecessive !== undefined

  if (observedGiven) {
    const aa = input.observedHomozygousDominant as number
    const ab = input.observedHeterozygous as number
    const bb = input.observedHomozygousRecessive as number
    for (const [name, value] of [['observedHomozygousDominant', aa], ['observedHeterozygous', ab], ['observedHomozygousRecessive', bb]] as const) {
      if (!Number.isFinite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or more.`)
    }
    const total = aa + ab + bb
    if (total === 0) return fail('invalid-argument', 'The observed counts are all zero, so there is no population to describe.')
    // Allele frequencies counted from the genotypes, which is the correct way round.
    q = (2 * bb + ab) / (2 * total)
  } else if (input.recessiveFrequency !== undefined) {
    q = input.recessiveFrequency
  } else if (input.affectedFraction !== undefined) {
    if (!Number.isFinite(input.affectedFraction) || input.affectedFraction < 0 || input.affectedFraction > 1) {
      return fail('out-of-range', 'The affected fraction is between 0 and 1.')
    }
    q = Math.sqrt(input.affectedFraction)
  } else {
    return fail(
      'invalid-argument',
      'Give a recessive allele frequency, the fraction of the population affected by a recessive condition, or all three observed genotype counts.'
    )
  }

  if (!Number.isFinite(q) || q < 0 || q > 1) return fail('out-of-range', 'An allele frequency is between 0 and 1.')
  const p = 1 - q

  const expected = {
    homozygousDominant: p * p,
    heterozygous: 2 * p * q,
    homozygousRecessive: q * q
  }

  let observed: HardyWeinbergReport['observed'] = null
  let chiSquare: number | null = null
  let atEquilibrium: boolean | null = null
  const warnings: string[] = []

  if (observedGiven) {
    const aa = input.observedHomozygousDominant as number
    const ab = input.observedHeterozygous as number
    const bb = input.observedHomozygousRecessive as number
    const total = aa + ab + bb
    observed = { homozygousDominant: aa, heterozygous: ab, homozygousRecessive: bb }
    const expectedCounts = [expected.homozygousDominant * total, expected.heterozygous * total, expected.homozygousRecessive * total]
    const observedCounts = [aa, ab, bb]
    chiSquare = 0
    let smallCells = 0
    for (let i = 0; i < 3; i += 1) {
      if (expectedCounts[i] < 5) smallCells += 1
      if (expectedCounts[i] > 0) chiSquare += Math.pow(observedCounts[i] - expectedCounts[i], 2) / expectedCounts[i]
    }
    // One degree of freedom, because the allele frequency was estimated from the same data.
    atEquilibrium = chiSquare < 3.841
    if (smallCells > 0) {
      warnings.push(`${smallCells} expected cell${smallCells === 1 ? ' has' : 's have'} a count below 5, so the chi-square test is unreliable here. That usually means a rare allele or a small sample.`)
    }
    if (!atEquilibrium) {
      warnings.push(
        `Chi-square is ${chiSquare.toFixed(3)} against 3.841 at the 5% level with one degree of freedom, so this population is not in equilibrium. That is the interesting result: one of the five conditions has failed, and which one is the question — selection, mutation, migration, non-random mating, or too small a population.`
      )
    }
  }

  const carrierFrequency = expected.heterozygous
  const carriersPerAffected = expected.homozygousRecessive === 0 ? Number.POSITIVE_INFINITY : carrierFrequency / expected.homozygousRecessive

  if (q < 0.05 && q > 0) {
    warnings.push(
      `With a recessive frequency of ${q.toFixed(5)}, about ${(carrierFrequency * 100).toFixed(3)}% of the population carries the allele and ${(expected.homozygousRecessive * 100).toExponential(2)}% is affected — ${carriersPerAffected.toFixed(0)} carriers for every affected person. That ratio is 2/q, and it is why a recessive condition persists in a population that selects hard against it.`
    )
  }

  return {
    dominantFrequency: p,
    recessiveFrequency: q,
    expected,
    observed,
    chiSquare,
    atEquilibrium,
    carrierFrequency,
    carriersPerAffected,
    conditions: Object.freeze([
      'No selection: every genotype survives and reproduces equally.',
      'No mutation changing one allele into the other.',
      'No migration in or out.',
      'Random mating with respect to this gene.',
      'A population large enough that chance does not shift the frequencies — which excludes most real populations of conservation interest.'
    ]),
    notes: Object.freeze([
      `Allele frequencies ${p.toFixed(5)} and ${q.toFixed(5)}, giving expected genotypes ${expected.homozygousDominant.toFixed(5)}, ${expected.heterozygous.toFixed(5)} and ${expected.homozygousRecessive.toFixed(5)}.`,
      `${(carrierFrequency * 100).toFixed(4)}% are carriers, which is ${carriersPerAffected === Number.POSITIVE_INFINITY ? 'infinitely many' : carriersPerAffected.toFixed(1)} per affected individual. For a rare allele that ratio is about 2/q and it is always larger than people expect.`,
      observedGiven
        ? 'The allele frequency was counted from the observed genotypes, which is the correct direction — inferring it from the affected fraction alone assumes the equilibrium being tested.'
        : 'No observed counts were given, so these are the expected frequencies and nothing has been tested.',
      'Hardy-Weinberg is a null model. A population matching it tells you the five conditions are not badly violated for this gene; one departing from it tells you something is happening, which is more useful.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface LinkageReport {
  /** The recombination frequency, as a fraction. */
  recombinationFrequency: number
  /** Map distance in centimorgans, which is the recombination frequency as a percentage. */
  mapDistance: number
  /** Whether the genes are linked at all, or assorting independently. */
  linked: boolean
  /** The four offspring classes and their expected counts. */
  classes: readonly { genotype: string; kind: 'parental' | 'recombinant'; observed: number; expectedIfUnlinked: number }[]
  /** Whether the departure from independence is significant. */
  chiSquare: number
  significantlyLinked: boolean
  /** How far the map distance can be trusted. */
  reliableDistance: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Recombination frequency and map distance from a test cross.
 *
 * The ceiling is the part that matters: recombination frequency cannot exceed 50%, because two genes far enough apart
 * recombine as often as not and become indistinguishable from unlinked. So a measured 50% means either unlinked or
 * very far apart on the same chromosome, and the two cannot be told apart by this measurement — only by a third
 * marker between them.
 *
 * Above about 20% the map distance underestimates the true distance, because double crossovers restore the parental
 * arrangement and go uncounted.
 */
export function linkage(input: {
  /** Counts of the four offspring classes from a test cross. */
  parentalOne: number
  parentalTwo: number
  recombinantOne: number
  recombinantTwo: number
}): LinkageReport | GeneticsError {
  const { parentalOne, parentalTwo, recombinantOne, recombinantTwo } = input
  for (const [name, value] of Object.entries({ parentalOne, parentalTwo, recombinantOne, recombinantTwo })) {
    if (!Number.isFinite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or more.`)
  }
  const total = parentalOne + parentalTwo + recombinantOne + recombinantTwo
  if (total === 0) return fail('invalid-argument', 'All four counts are zero, so there is no cross to analyse.')

  const recombinants = recombinantOne + recombinantTwo
  const frequency = recombinants / total
  const warnings: string[] = []

  if (frequency > 0.5) {
    warnings.push(
      `The recombinant classes outnumber the parental ones, giving a frequency of ${frequency.toFixed(4)} above the 0.5 ceiling. Recombination cannot exceed 50%, so the classes have probably been labelled the wrong way round — what is called recombinant here is the parental arrangement.`
    )
  }

  // Chi-square against independent assortment, which predicts all four classes equal.
  const expectedEach = total / 4
  const chiSquare = [parentalOne, parentalTwo, recombinantOne, recombinantTwo].reduce(
    (sum, one) => sum + Math.pow(one - expectedEach, 2) / expectedEach,
    0
  )
  // Three degrees of freedom, critical value 7.815 at the 5% level.
  const significant = chiSquare > 7.815

  const linked = frequency < 0.5 - 1e-9 && significant
  if (Math.abs(frequency - 0.5) < 0.05) {
    warnings.push(
      `A recombination frequency of ${frequency.toFixed(4)} is indistinguishable from 50%, which means either the genes are on different chromosomes or they are far enough apart on the same one to recombine freely. This measurement cannot tell those apart — that needs a third marker between them.`
    )
  }
  if (frequency > 0.2 && frequency < 0.5) {
    warnings.push(
      `Above about 20% the map distance underestimates the real distance, because a double crossover restores the parental arrangement and goes uncounted. ${(frequency * 100).toFixed(1)} cM is a floor rather than a measurement.`
    )
  }
  if (total < 100) {
    warnings.push(`Only ${total} offspring. A recombination frequency from that few has a wide confidence interval — roughly plus or minus ${(Math.sqrt((frequency * (1 - frequency)) / total) * 1.96 * 100).toFixed(1)} percentage points.`)
  }

  return {
    recombinationFrequency: frequency,
    mapDistance: frequency * 100,
    linked,
    classes: Object.freeze([
      { genotype: 'parental one', kind: 'parental' as const, observed: parentalOne, expectedIfUnlinked: expectedEach },
      { genotype: 'parental two', kind: 'parental' as const, observed: parentalTwo, expectedIfUnlinked: expectedEach },
      { genotype: 'recombinant one', kind: 'recombinant' as const, observed: recombinantOne, expectedIfUnlinked: expectedEach },
      { genotype: 'recombinant two', kind: 'recombinant' as const, observed: recombinantTwo, expectedIfUnlinked: expectedEach }
    ]),
    chiSquare,
    significantlyLinked: significant,
    reliableDistance: frequency <= 0.2,
    notes: Object.freeze([
      `${recombinants} recombinants out of ${total} gives a frequency of ${frequency.toFixed(4)}, or ${(frequency * 100).toFixed(2)} cM.`,
      `Chi-square against independent assortment is ${chiSquare.toFixed(3)} on three degrees of freedom, so the departure from independence is ${significant ? 'significant' : 'not significant'} at the 5% level.`,
      'A centimorgan is one percent recombination. It is a genetic distance rather than a physical one, and the relationship between them varies along a chromosome — recombination is suppressed near a centromere and elevated at the tips.',
      'The 50% ceiling is not a measurement limit but a property of meiosis: genes far enough apart recombine as often as not, which is exactly what unlinked genes do.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const GENETICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A sequence containing both thymine and uracil is refused as neither DNA nor RNA, because every calculation downstream of it would be wrong in a way nobody notices.',
  'IUPAC ambiguity codes are recognised as legitimate, and they make composition figures approximate.',
  'Melting temperature uses the formula appropriate to the length, and names it. The simple GC rule is badly wrong for a short primer.',
  'Every translation states its reading frame and reports what the other five would give, because the wrong frame gives an unrelated protein.',
  'Translation uses the standard genetic code. Mitochondria and some organisms use variant tables where TGA is tryptophan rather than a stop.',
  'A Punnett square lists its assumptions: complete dominance, independent assortment, equal survival, no epistasis, and a large sample.',
  'Ratios are probabilities per offspring. A small family can show none of a recessive phenotype and that is not evidence against the model.',
  'Hardy-Weinberg is a null model, and a population departing from it is the more informative result.',
  'Where observed genotypes are given, the allele frequency is counted from them rather than inferred from the affected fraction, which would assume the equilibrium being tested.',
  'Recombination frequency cannot exceed 50%, and above 20% the map distance is a floor because double crossovers go uncounted.'
])
