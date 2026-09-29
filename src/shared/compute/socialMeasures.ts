/**
 * Social measurement: survey reliability, agreement between raters, inequality, and effect sizes.
 *
 * The shared social-measurement engine for Orbis Pages. Every coefficient comes with what it does and does not
 * license you to say, because these are the numbers most often quoted past what they can support — a Cronbach's
 * alpha of 0.9 is routinely reported as evidence that a scale measures one thing, which it is not.
 *
 * ## Why agreement is not the same as percentage agreement
 *
 * Two raters who both label 95% of cases "no" will agree 90% of the time by chance alone. Cohen's kappa subtracts
 * that chance agreement, which is why a kappa can be near zero while raw agreement is over 90%. Reporting the raw
 * figure for a skewed category is the single most common error in coding reliability, so both are always returned
 * together.
 *
 * ## Why alpha is not a measure of unidimensionality
 *
 * Cronbach's alpha rises with the number of items whatever they measure. A twenty-item questionnaire covering three
 * unrelated topics can reach 0.8. Alpha measures how much the items covary, which is necessary for a scale to hold
 * together and nowhere near sufficient — and this is stated on every result rather than left for the reader to
 * remember.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * agreement      vs  agreement beyond chance  -- 90% raw against a kappa of 0.05
 * reliability    vs  validity                 -- consistent against measuring the right thing
 * alpha          vs  unidimensionality        -- items covary against items measuring one thing
 * significance   vs  effect size              -- whether it is there against whether it matters
 * ordinal        vs  interval                 -- Likert ranks against numbers you can average
 * Gini           vs  what people have         -- one number against a whole distribution
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface MeasureError {
  error: 'invalid-argument' | 'not-finite' | 'too-few' | 'too-many' | 'out-of-range' | 'no-variance' | 'no-solution'
  message: string
}

export const isMeasureError = (value: unknown): value is MeasureError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: MeasureError['error'], message: string): MeasureError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const MEASURE_LIMITS = Object.freeze({ items: 500, respondents: 20_000, categories: 200, raters: 100 })

// ---------------------------------------------------------------- scale reliability

export interface ReliabilityReport {
  /** Cronbach's alpha. How much the items covary, relative to their total variance. */
  alpha: number
  /** The same quantity with the number of items held constant, so it is comparable across scales of different lengths. */
  averageInterItemCorrelation: number
  items: number
  respondents: number
  /** What alpha would be with each item removed, which is how a bad item is found. */
  ifItemRemoved: readonly { item: number; alpha: number; itemTotalCorrelation: number; verdict: string }[]
  band: string
  /** McDonald's omega is generally preferred; this says so rather than pretending alpha is the last word. */
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Cronbach's alpha, with the item-level diagnostics that make it useful and the caveat that makes it honest.
 *
 * Alpha on its own says little. The item-total correlations and the alpha-if-removed column are what identify the
 * item that does not belong, and a reverse-coded item that nobody reversed shows up there as a negative correlation
 * — which is by far the commonest reason a scale fails.
 *
 * Alpha rises with the number of items regardless of what they measure, so the average inter-item correlation is
 * reported alongside: that one does not, and it is the fairer comparison between scales of different lengths.
 */
export function scaleReliability(input: {
  /** One row per respondent, one column per item. */
  responses: readonly (readonly number[])[]
}): ReliabilityReport | MeasureError {
  const rows = input.responses
  if (rows.length < 2) return fail('too-few', 'Alpha needs at least two respondents, and is unstable below about thirty.')
  if (rows.length > MEASURE_LIMITS.respondents) {
    return fail('too-many', `That is ${rows.length} respondents; this handles up to ${MEASURE_LIMITS.respondents}.`)
  }
  const items = rows[0].length
  if (items < 2) return fail('too-few', 'Alpha needs at least two items — it measures how much they covary, and one item covaries with nothing.')
  if (items > MEASURE_LIMITS.items) return fail('too-many', `That is ${items} items; this handles up to ${MEASURE_LIMITS.items}.`)

  for (const [i, row] of rows.entries()) {
    if (row.length !== items) {
      return fail('invalid-argument', `Respondent ${i + 1} answered ${row.length} items and the first answered ${items}. Missing answers have to be handled before this, because how they are handled changes the answer.`)
    }
    for (const [j, value] of row.entries()) {
      if (!finite(value)) return fail('not-finite', `Respondent ${i + 1}, item ${j + 1} is not a finite number.`)
    }
  }

  const varianceOf = (values: readonly number[]): number => {
    const mean = values.reduce((sum, one) => sum + one, 0) / values.length
    return values.reduce((sum, one) => sum + (one - mean) * (one - mean), 0) / (values.length - 1)
  }

  const columns: number[][] = []
  for (let j = 0; j < items; j += 1) columns.push(rows.map((row) => row[j]))
  const itemVariances = columns.map(varianceOf)
  const totals = rows.map((row) => row.reduce((sum, one) => sum + one, 0))
  const totalVariance = varianceOf(totals)

  if (totalVariance === 0) {
    return fail(
      'no-variance',
      'Every respondent gave the same total, so there is no variance to explain and alpha is undefined. That usually means the data is constant or a column was duplicated.'
    )
  }

  const alphaFrom = (variances: readonly number[], total: number, count: number): number =>
    (count / (count - 1)) * (1 - variances.reduce((sum, one) => sum + one, 0) / total)

  const alpha = alphaFrom(itemVariances, totalVariance, items)

  // Alpha from the average inter-item correlation, which is the length-independent version.
  const correlation = (a: readonly number[], b: readonly number[]): number => {
    const meanA = a.reduce((s, one) => s + one, 0) / a.length
    const meanB = b.reduce((s, one) => s + one, 0) / b.length
    let cov = 0
    let varA = 0
    let varB = 0
    for (let i = 0; i < a.length; i += 1) {
      cov += (a[i] - meanA) * (b[i] - meanB)
      varA += (a[i] - meanA) ** 2
      varB += (b[i] - meanB) ** 2
    }
    return varA === 0 || varB === 0 ? 0 : cov / Math.sqrt(varA * varB)
  }

  let correlationSum = 0
  let pairs = 0
  for (let i = 0; i < items; i += 1) {
    for (let j = i + 1; j < items; j += 1) {
      correlationSum += correlation(columns[i], columns[j])
      pairs += 1
    }
  }
  const averageInterItem = pairs === 0 ? 0 : correlationSum / pairs

  const ifRemoved: ReliabilityReport['ifItemRemoved'][number][] = []
  const warnings: string[] = []
  for (let j = 0; j < items; j += 1) {
    const keptColumns = columns.filter((_, index) => index !== j)
    const keptVariances = itemVariances.filter((_, index) => index !== j)
    const keptTotals = rows.map((row) => row.reduce((sum, one, index) => (index === j ? sum : sum + one), 0))
    const keptTotalVariance = varianceOf(keptTotals)
    const withoutAlpha =
      items - 1 < 2 || keptTotalVariance === 0 ? Number.NaN : alphaFrom(keptVariances, keptTotalVariance, items - 1)
    // Corrected item-total: the item against the sum of the others, not against a total that includes itself.
    const itemTotal = correlation(columns[j], keptTotals)
    void keptColumns

    let verdict: string
    if (itemTotal < 0) {
      verdict = 'Negatively correlated with the rest of the scale. Almost always a reverse-coded item that was not reversed.'
      warnings.push(
        `Item ${j + 1} correlates negatively with the rest of the scale (${itemTotal.toFixed(3)}). That is nearly always a reverse-worded item that nobody reverse-scored, and it drags alpha down for every other item too.`
      )
    } else if (itemTotal < 0.3) {
      verdict = 'Weakly related to the rest of the scale. Worth asking what it is measuring.'
    } else if (Number.isFinite(withoutAlpha) && withoutAlpha > alpha + 0.02) {
      verdict = 'Removing it would raise alpha. Consider whether it belongs.'
    } else {
      verdict = 'Contributes to the scale.'
    }
    ifRemoved.push({ item: j + 1, alpha: withoutAlpha, itemTotalCorrelation: itemTotal, verdict })
  }

  const band =
    alpha >= 0.9
      ? 'very high — high enough to suspect redundant items rather than a good scale'
      : alpha >= 0.8
        ? 'good'
        : alpha >= 0.7
          ? 'acceptable for most purposes'
          : alpha >= 0.6
            ? 'questionable'
            : 'poor'

  if (rows.length < 30) {
    warnings.push(`Only ${rows.length} respondents. Alpha is unstable below about thirty and its confidence interval at this size is very wide.`)
  }
  if (alpha > 0.95) {
    warnings.push(
      `Alpha of ${alpha.toFixed(3)} is high enough to be a problem rather than a success: it usually means several items are asking the same question in different words, which wastes the respondent’s time without adding information.`
    )
  }
  if (alpha < 0) {
    warnings.push(
      'Alpha is negative, which is not a low reliability but an impossible one. It happens when items covary negatively — check for a reverse-coded item that was not reversed.'
    )
  }

  return {
    alpha,
    averageInterItemCorrelation: averageInterItem,
    items,
    respondents: rows.length,
    ifItemRemoved: Object.freeze(ifRemoved),
    band,
    notes: Object.freeze([
      `Alpha is ${alpha.toFixed(4)} over ${items} items and ${rows.length} respondents — ${band}.`,
      'Alpha measures how much the items covary. It does not measure whether they measure one thing: a twenty-item questionnaire covering three unrelated topics can reach 0.8, because alpha rises with the number of items whatever they are.',
      `The average inter-item correlation is ${averageInterItem.toFixed(4)}. That one does not rise with length, so it is the fairer comparison between scales of different sizes.`,
      'Reliability is not validity. A scale can be perfectly consistent and measure the wrong thing, and no coefficient here can tell you which.',
      'McDonald’s omega is generally preferred to alpha now, because it does not assume every item contributes equally. Alpha is here because it is what is still reported.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- rater agreement

export interface AgreementReport {
  /** The fraction of cases the raters labelled the same. Almost always misleadingly high. */
  rawAgreement: number
  /** The agreement expected from the marginal frequencies alone. */
  expectedByChance: number
  /** Cohen's kappa: agreement beyond chance. */
  kappa: number
  /** Weighted kappa, for ordered categories, where being one apart is less wrong than being three apart. */
  weightedKappa: number | null
  band: string
  categories: readonly string[]
  /** The confusion matrix, so the pattern of disagreement is visible rather than just its size. */
  matrix: readonly (readonly number[])[]
  /** The categories the raters disagree about most. */
  worstConfusions: readonly { first: string; second: string; count: number }[]
  cases: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Agreement between two raters, with chance agreement subtracted and the raw figure shown alongside.
 *
 * Both are always returned because the gap between them is the finding. Two raters labelling a rare event will agree
 * on almost every case and still be doing no better than guessing, and a paper reporting 94% agreement on a category
 * that occurs 5% of the time has reported nothing.
 *
 * The confusion matrix is returned too. A kappa of 0.5 with disagreement spread evenly is a different problem from a
 * kappa of 0.5 where two specific categories are being confused, and only the second one can be fixed by rewriting
 * the coding manual.
 */
export function raterAgreement(input: {
  /** One entry per case: what each of the two raters said. */
  ratings: readonly { first: string; second: string }[]
  /** For ordered categories, in order, so weighted kappa can be computed. */
  orderedCategories?: readonly string[]
}): AgreementReport | MeasureError {
  const { ratings } = input
  if (ratings.length < 2) return fail('too-few', 'Agreement needs at least two cases.')
  if (ratings.length > MEASURE_LIMITS.respondents) {
    return fail('too-many', `That is ${ratings.length} cases; this handles up to ${MEASURE_LIMITS.respondents}.`)
  }

  const categorySet = new Set<string>()
  for (const [i, one] of ratings.entries()) {
    if (typeof one.first !== 'string' || typeof one.second !== 'string') {
      return fail('invalid-argument', `Case ${i + 1} has a rating that is not a label.`)
    }
    categorySet.add(one.first)
    categorySet.add(one.second)
  }
  if (categorySet.size > MEASURE_LIMITS.categories) {
    return fail('too-many', `That is ${categorySet.size} categories; this handles up to ${MEASURE_LIMITS.categories}.`)
  }
  if (categorySet.size < 2) {
    return fail(
      'no-variance',
      'Both raters used only one category, so they agree perfectly and kappa is undefined — there is no chance agreement to subtract because chance agreement is also 100%.'
    )
  }

  const categories = input.orderedCategories ?? [...categorySet].sort()
  if (input.orderedCategories !== undefined) {
    for (const one of categorySet) {
      if (!categories.includes(one)) {
        return fail('invalid-argument', `"${one}" appears in the ratings and not in the ordered category list.`)
      }
    }
  }
  const index = new Map(categories.map((one, i) => [one, i]))

  const size = categories.length
  const matrix: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  for (const one of ratings) {
    matrix[index.get(one.first) as number][index.get(one.second) as number] += 1
  }

  const n = ratings.length
  let observed = 0
  for (let i = 0; i < size; i += 1) observed += matrix[i][i]
  const rawAgreement = observed / n

  const rowTotals = matrix.map((row) => row.reduce((sum, one) => sum + one, 0))
  const columnTotals = categories.map((_, j) => matrix.reduce((sum, row) => sum + row[j], 0))
  let expected = 0
  for (let i = 0; i < size; i += 1) expected += (rowTotals[i] * columnTotals[i]) / (n * n)

  const kappa = expected >= 1 ? 0 : (rawAgreement - expected) / (1 - expected)

  // Weighted kappa, with quadratic weights, only when the categories are ordered.
  let weightedKappa: number | null = null
  if (input.orderedCategories !== undefined && size > 2) {
    let observedWeighted = 0
    let expectedWeighted = 0
    const maxDistance = (size - 1) * (size - 1)
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        const weight = 1 - ((i - j) * (i - j)) / maxDistance
        observedWeighted += weight * (matrix[i][j] / n)
        expectedWeighted += weight * ((rowTotals[i] / n) * (columnTotals[j] / n))
      }
    }
    weightedKappa = expectedWeighted >= 1 ? 0 : (observedWeighted - expectedWeighted) / (1 - expectedWeighted)
  }

  const confusions: AgreementReport['worstConfusions'][number][] = []
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j || matrix[i][j] === 0) continue
      confusions.push({ first: categories[i], second: categories[j], count: matrix[i][j] })
    }
  }
  confusions.sort((a, b) => b.count - a.count)

  // Landis and Koch, which is conventional and arbitrary, and is labelled as such.
  const band =
    kappa < 0
      ? 'worse than chance'
      : kappa < 0.21
        ? 'slight'
        : kappa < 0.41
          ? 'fair'
          : kappa < 0.61
            ? 'moderate'
            : kappa < 0.81
              ? 'substantial'
              : 'almost perfect'

  const warnings: string[] = []
  if (rawAgreement - kappa > 0.3) {
    warnings.push(
      `Raw agreement is ${(rawAgreement * 100).toFixed(1)}% and kappa is only ${kappa.toFixed(3)}. The categories are skewed enough that most of that agreement is chance — quoting the raw figure here would be reporting nothing.`
    )
  }
  const rarest = Math.min(...rowTotals.filter((one) => one > 0))
  if (rarest < n * 0.05) {
    warnings.push(
      `The rarest category has only ${rarest} of ${n} cases. Kappa is unstable and pessimistic with skewed marginals, which is a known limitation rather than a finding about these raters.`
    )
  }
  if (input.orderedCategories === undefined && size > 2) {
    warnings.push(
      'The categories were treated as unordered, so every disagreement counts the same. If they are ordered — a Likert scale, a severity rating — pass them in order and weighted kappa will count a near miss as less wrong than a far one.'
    )
  }

  return {
    rawAgreement,
    expectedByChance: expected,
    kappa,
    weightedKappa,
    band,
    categories: Object.freeze([...categories]),
    matrix: Object.freeze(matrix.map((row) => Object.freeze([...row]))),
    worstConfusions: Object.freeze(confusions.slice(0, 10)),
    cases: n,
    notes: Object.freeze([
      `Raw agreement ${(rawAgreement * 100).toFixed(1)}%, chance agreement ${(expected * 100).toFixed(1)}%, kappa ${kappa.toFixed(4)} — ${band}.`,
      'Both figures are given because the gap between them is the finding. Two raters labelling a rare event agree on nearly every case while doing no better than guessing.',
      weightedKappa !== null
        ? `Weighted kappa is ${weightedKappa.toFixed(4)}, counting a disagreement of one category as less wrong than one of three. For ordered categories that is the figure to use.`
        : 'No weighted kappa: the categories were not given in order, so there is no basis for calling one disagreement smaller than another.',
      'The bands are Landis and Koch, which are conventional and entirely arbitrary. There is no threshold at which agreement becomes adequate independently of what it is for.',
      'The confusion matrix is returned because the pattern matters: two specific categories being confused can be fixed by rewriting the coding manual, and disagreement spread evenly cannot.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/**
 * Fleiss' kappa, for more than two raters where the raters are not the same across cases.
 *
 * Cohen's kappa needs the same two raters throughout. Fleiss does not, which makes it the right measure for a panel
 * where different subsets rate different items — and the wrong one when the raters *are* fixed, because it throws
 * away the information about which rater disagreed.
 */
export interface FleissReport {
  kappa: number
  /** Agreement on each case, which shows whether disagreement is spread or concentrated. */
  perCase: readonly { case: number; agreement: number }[]
  /** How well each category was agreed on, which is not the same for all of them. */
  perCategory: readonly { category: string; kappa: number; share: number }[]
  raters: number
  cases: number
  band: string
  notes: readonly string[]
  warnings: readonly string[]
}

export function fleissKappa(input: {
  /** One row per case, counting how many raters chose each category. Every row must total the same. */
  counts: readonly (readonly number[])[]
  categories?: readonly string[]
}): FleissReport | MeasureError {
  const rows = input.counts
  if (rows.length < 2) return fail('too-few', 'Fleiss kappa needs at least two cases.')
  if (rows.length > MEASURE_LIMITS.respondents) return fail('too-many', `That is ${rows.length} cases; this handles up to ${MEASURE_LIMITS.respondents}.`)
  const size = rows[0].length
  if (size < 2) return fail('too-few', 'There have to be at least two categories.')
  if (size > MEASURE_LIMITS.categories) return fail('too-many', `That is ${size} categories; this handles up to ${MEASURE_LIMITS.categories}.`)

  const raters = rows[0].reduce((sum, one) => sum + one, 0)
  if (raters < 2) return fail('too-few', 'Each case needs at least two ratings.')
  if (raters > MEASURE_LIMITS.raters) return fail('too-many', `That is ${raters} raters; this handles up to ${MEASURE_LIMITS.raters}.`)

  for (const [i, row] of rows.entries()) {
    if (row.length !== size) return fail('invalid-argument', `Case ${i + 1} has ${row.length} categories and the first has ${size}.`)
    let total = 0
    for (const [j, value] of row.entries()) {
      if (!Number.isInteger(value) || value < 0) {
        return fail('invalid-argument', `Case ${i + 1}, category ${j + 1} is ${value}. These are counts of raters, so whole numbers of zero or more.`)
      }
      total += value
    }
    if (total !== raters) {
      return fail(
        'invalid-argument',
        `Case ${i + 1} has ${total} ratings and case 1 has ${raters}. Fleiss kappa needs the same number of ratings per case; a case rated by fewer raters has to be handled before this.`
      )
    }
  }

  const categories = input.categories ?? rows[0].map((_, j) => `category ${j + 1}`)
  if (categories.length !== size) return fail('invalid-argument', `There are ${categories.length} category names for ${size} columns.`)

  const n = rows.length
  const perCase = rows.map((row, i) => {
    const agreeingPairs = row.reduce((sum, one) => sum + one * (one - 1), 0)
    return { case: i + 1, agreement: agreeingPairs / (raters * (raters - 1)) }
  })
  const observed = perCase.reduce((sum, one) => sum + one.agreement, 0) / n
  const shares = categories.map((_, j) => rows.reduce((sum, row) => sum + row[j], 0) / (n * raters))
  const expected = shares.reduce((sum, one) => sum + one * one, 0)
  const kappa = expected >= 1 ? 0 : (observed - expected) / (1 - expected)

  // Per-category kappa, which shows that a panel can agree well on one label and badly on another.
  const perCategory = categories.map((category, j) => {
    const share = shares[j]
    let sum = 0
    for (const row of rows) sum += row[j] * (raters - row[j])
    const denominator = n * raters * (raters - 1) * share * (1 - share)
    return { category, kappa: denominator === 0 ? 0 : 1 - sum / denominator, share }
  })

  const band =
    kappa < 0 ? 'worse than chance' : kappa < 0.21 ? 'slight' : kappa < 0.41 ? 'fair' : kappa < 0.61 ? 'moderate' : kappa < 0.81 ? 'substantial' : 'almost perfect'

  const warnings: string[] = []
  const worstCategory = perCategory.reduce((worst, one) => (one.kappa < worst.kappa ? one : worst))
  if (worstCategory.kappa < kappa - 0.2) {
    warnings.push(
      `Agreement on "${worstCategory.category}" is much worse than overall (${worstCategory.kappa.toFixed(3)} against ${kappa.toFixed(3)}). A single hard-to-apply category is a fixable problem with the coding manual; an overall figure hides it.`
    )
  }

  return {
    kappa,
    perCase: Object.freeze(perCase),
    perCategory: Object.freeze(perCategory),
    raters,
    cases: n,
    band,
    notes: Object.freeze([
      `Fleiss kappa is ${kappa.toFixed(4)} over ${n} cases and ${raters} ratings each — ${band}.`,
      'Fleiss does not require the same raters throughout, which makes it right for a panel where different subsets rate different items. When the raters are fixed, Cohen’s kappa is better, because it keeps the information about which rater disagreed.',
      'Per-category kappas are reported because a panel can agree well on one label and badly on another, and the overall figure hides that.',
      'The bands are Landis and Koch, conventional and arbitrary.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- inequality

export interface InequalityReport {
  /** 0 is perfect equality, 1 is one person holding everything. */
  gini: number
  /** The Lorenz curve, for drawing, as cumulative population against cumulative share. */
  lorenz: readonly { population: number; share: number }[]
  /** The share held by each fifth, which is more legible than the Gini. */
  quintileShares: readonly { quintile: number; share: number }[]
  /** The ratio of the top fifth to the bottom fifth. */
  quintileRatio: number | null
  /** The share of the total held by the top 1% and 10%. */
  topShares: { onePercent: number; tenPercent: number }
  /** The 20:20 and Palma ratios, which are less compressed than the Gini at the extremes. */
  palmaRatio: number | null
  count: number
  total: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Inequality, as a Gini coefficient and as the shares the Gini compresses.
 *
 * The Gini is reported because it is universally quoted, and the quintile shares are reported because the Gini is
 * one number standing in for a whole distribution and two very different distributions can share one. It is also
 * least sensitive exactly where people care most — at the top and the bottom — which is why the top shares and the
 * Palma ratio are here.
 */
export function inequality(input: { values: readonly number[]; weights?: readonly number[] }): InequalityReport | MeasureError {
  const values = input.values
  if (values.length < 2) return fail('too-few', 'Inequality needs at least two values.')
  if (values.length > MEASURE_LIMITS.respondents) {
    return fail('too-many', `That is ${values.length} values; this handles up to ${MEASURE_LIMITS.respondents}.`)
  }
  for (const [i, one] of values.entries()) {
    if (!finite(one)) return fail('not-finite', `Value ${i + 1} is not a finite number.`)
    if (one < 0) {
      return fail(
        'invalid-argument',
        `Value ${i + 1} is negative. A Gini coefficient on data with negative values can exceed 1 and stops meaning what it usually means — negative wealth is real and needs a measure built for it.`
      )
    }
  }
  if (input.weights !== undefined && input.weights.length !== values.length) {
    return fail('invalid-argument', `There are ${input.weights.length} weights for ${values.length} values.`)
  }

  const weights = input.weights ?? values.map(() => 1)
  for (const [i, one] of weights.entries()) {
    if (!finite(one) || one <= 0) return fail('invalid-argument', `Weight ${i + 1} has to be greater than zero.`)
  }

  const paired = values.map((value, i) => ({ value, weight: weights[i] })).sort((a, b) => a.value - b.value)
  const totalWeight = paired.reduce((sum, one) => sum + one.weight, 0)
  const total = paired.reduce((sum, one) => sum + one.value * one.weight, 0)

  if (total === 0) {
    return fail('no-variance', 'Everything is zero, so there is nothing to be unequal about and the Gini coefficient is undefined.')
  }

  // The Gini from the Lorenz curve area, which handles weights correctly.
  const lorenz: InequalityReport['lorenz'][number][] = [{ population: 0, share: 0 }]
  let cumulativeWeight = 0
  let cumulativeValue = 0
  let area = 0
  let previousPopulation = 0
  let previousShare = 0
  for (const one of paired) {
    cumulativeWeight += one.weight
    cumulativeValue += one.value * one.weight
    const population = cumulativeWeight / totalWeight
    const share = cumulativeValue / total
    area += ((population - previousPopulation) * (share + previousShare)) / 2
    lorenz.push({ population, share })
    previousPopulation = population
    previousShare = share
  }
  const gini = 1 - 2 * area

  const shareAbove = (fraction: number): number => {
    const threshold = 1 - fraction
    let sum = 0
    let weightSoFar = 0
    for (const one of paired) {
      const before = weightSoFar / totalWeight
      weightSoFar += one.weight
      const after = weightSoFar / totalWeight
      if (after <= threshold) continue
      // Count only the part of this observation's weight above the threshold.
      const portion = (after - Math.max(before, threshold)) / (after - before)
      sum += one.value * one.weight * portion
    }
    return sum / total
  }

  const quintileShares = [1, 2, 3, 4, 5].map((quintile) => {
    const from = (quintile - 1) / 5
    const to = quintile / 5
    let sum = 0
    let weightSoFar = 0
    for (const one of paired) {
      const before = weightSoFar / totalWeight
      weightSoFar += one.weight
      const after = weightSoFar / totalWeight
      const overlap = Math.max(0, Math.min(after, to) - Math.max(before, from))
      if (overlap <= 0) continue
      sum += one.value * one.weight * (overlap / (after - before))
    }
    return { quintile, share: sum / total }
  })

  const bottom = quintileShares[0].share
  const top = quintileShares[4].share
  const bottomForty = quintileShares[0].share + quintileShares[1].share

  const warnings: string[] = []
  if (values.length < 20) {
    warnings.push(`Only ${values.length} values. Quintile shares from fewer than twenty observations are dominated by which side of a boundary each one falls, and the Gini is barely more stable.`)
  }

  return {
    gini,
    lorenz: Object.freeze(lorenz),
    quintileShares: Object.freeze(quintileShares),
    quintileRatio: bottom === 0 ? null : top / bottom,
    topShares: { onePercent: shareAbove(0.01), tenPercent: shareAbove(0.1) },
    palmaRatio: bottomForty === 0 ? null : shareAbove(0.1) / bottomForty,
    count: values.length,
    total,
    notes: Object.freeze([
      `The Gini coefficient is ${gini.toFixed(4)}. Zero is perfect equality and one is a single holder of everything.`,
      `The top fifth holds ${(top * 100).toFixed(1)}% and the bottom fifth ${(bottom * 100).toFixed(1)}%. Those shares are reported because the Gini is one number standing for a whole distribution, and two very different distributions can share a Gini.`,
      `The top 1% holds ${(shareAbove(0.01) * 100).toFixed(1)}% and the top 10% holds ${(shareAbove(0.1) * 100).toFixed(1)}%. The Gini is least sensitive exactly at the extremes, which is where most of the argument is.`,
      bottomForty === 0
        ? 'The Palma ratio is undefined because the bottom 40% holds nothing at all.'
        : `The Palma ratio — the top tenth against the bottom two fifths — is ${(shareAbove(0.1) / bottomForty).toFixed(3)}. It moves more than the Gini when the top pulls away.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- effect size

export type EffectMeasure = 'cohens-d' | 'hedges-g' | 'glass-delta' | 'odds-ratio' | 'risk-ratio' | 'cramers-v'

export const EFFECT_MEASURES: readonly EffectMeasure[] = Object.freeze([
  'cohens-d',
  'hedges-g',
  'glass-delta',
  'odds-ratio',
  'risk-ratio',
  'cramers-v'
])

export const EFFECT_FACTS: Readonly<Record<EffectMeasure, { label: string; needs: string; useWhen: string; caution: string }>> =
  Object.freeze({
    'cohens-d': {
      label: "Cohen's d",
      needs: 'Two means, two standard deviations and two sample sizes.',
      useWhen: 'Comparing two group means with similar variances and reasonable sample sizes.',
      caution: 'Biased upward in small samples. Use Hedges’ g below about twenty per group.'
    },
    'hedges-g': {
      label: "Hedges' g",
      needs: 'The same as Cohen’s d.',
      useWhen: 'Small samples. It is d with a correction for the upward bias.',
      caution: 'The correction is small above about fifty per group, where d and g agree closely.'
    },
    'glass-delta': {
      label: "Glass's delta",
      needs: 'Two means and the control group’s standard deviation.',
      useWhen: 'The treatment may have changed the variance as well as the mean, so pooling them would be wrong.',
      caution: 'Depends entirely on the control group’s spread, so it is noisier than d when the control group is small.'
    },
    'odds-ratio': {
      label: 'Odds ratio',
      needs: 'A two-by-two table of counts.',
      useWhen: 'Case-control studies, and logistic regression output.',
      caution: 'Routinely misread as a risk ratio. When the outcome is common the two differ enormously, and the odds ratio is always the more extreme.'
    },
    'risk-ratio': {
      label: 'Risk ratio',
      needs: 'A two-by-two table of counts.',
      useWhen: 'Cohort studies and trials, where the risk in each group is meaningful.',
      caution: 'Cannot be computed from a case-control study, where the sampling fixes the outcome counts.'
    },
    'cramers-v': {
      label: "Cramér's V",
      needs: 'A contingency table of any size.',
      useWhen: 'Association between two categorical variables with more than two levels.',
      caution: 'Says how strong the association is and nothing about its direction or shape.'
    }
  })

export interface EffectReport {
  measure: EffectMeasure
  label: string
  value: number
  /** A 95% interval, where one can be computed without assuming more than was given. */
  interval: { low: number; high: number } | null
  band: string
  useWhen: string
  caution: string
  /** For the two-group measures: how much the distributions overlap, which is more legible than d. */
  overlap: number | null
  /** How many people you would have to treat for one extra good outcome, where that applies. */
  numberNeededToTreat: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * An effect size, with the overlap between groups reported because it is far more legible than d.
 *
 * "Cohen's d of 0.5" means little to most readers. "The distributions overlap by 80%" means a great deal, and it is
 * the same fact. Both are given.
 *
 * Effect size is what significance testing does not tell you. A tiny effect in a large sample is significant and
 * unimportant; a large effect in a small sample may be neither significant nor absent. Neither number answers the
 * other's question.
 */
export function effectSize(input: {
  measure: EffectMeasure
  /** For the mean-difference measures. */
  meanA?: number
  meanB?: number
  sdA?: number
  sdB?: number
  nA?: number
  nB?: number
  /** For the table measures: a, b, c, d of a two-by-two, or a full table. */
  table?: readonly (readonly number[])[]
}): EffectReport | MeasureError {
  const facts = EFFECT_FACTS[input.measure]
  if (!facts) return fail('invalid-argument', `"${input.measure}" is not one of: ${EFFECT_MEASURES.join(', ')}.`)

  const warnings: string[] = []
  let value: number
  let interval: EffectReport['interval'] = null
  let overlap: number | null = null
  let numberNeededToTreat: number | null = null
  let band: string

  const meanMeasures = ['cohens-d', 'hedges-g', 'glass-delta']
  if (meanMeasures.includes(input.measure)) {
    const { meanA, meanB, sdA, sdB, nA, nB } = input
    if (meanA === undefined || meanB === undefined || sdA === undefined || nA === undefined || nB === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    if (input.measure !== 'glass-delta' && sdB === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    for (const [name, one] of Object.entries({ meanA, meanB, sdA, nA, nB })) {
      if (!finite(one)) return fail('not-finite', `"${name}" has to be a finite number.`)
    }
    if (sdA <= 0 || (sdB !== undefined && sdB <= 0)) return fail('invalid-argument', 'Standard deviations have to be greater than zero.')
    if (nA < 2 || nB < 2) return fail('too-few', 'Each group needs at least two observations.')

    const spread =
      input.measure === 'glass-delta'
        ? sdA
        : Math.sqrt(((nA - 1) * sdA * sdA + (nB - 1) * (sdB as number) ** 2) / (nA + nB - 2))
    const d = (meanB - meanA) / spread
    value = input.measure === 'hedges-g' ? d * (1 - 3 / (4 * (nA + nB) - 9)) : d

    const standardError = Math.sqrt((nA + nB) / (nA * nB) + (value * value) / (2 * (nA + nB)))
    interval = { low: value - 1.96 * standardError, high: value + 1.96 * standardError }

    // The overlapping coefficient for two normal distributions of equal variance.
    const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2))
    overlap = 2 * normalCdf(-Math.abs(value) / 2)

    const magnitude = Math.abs(value)
    band = magnitude < 0.2 ? 'negligible' : magnitude < 0.5 ? 'small' : magnitude < 0.8 ? 'medium' : 'large'

    if (input.measure === 'cohens-d' && Math.min(nA, nB) < 20) {
      warnings.push(
        `With ${Math.min(nA, nB)} in the smaller group, Cohen’s d is biased upward. Hedges’ g corrects for it and would give ${(d * (1 - 3 / (4 * (nA + nB) - 9))).toFixed(4)}.`
      )
    }
    if (input.measure !== 'glass-delta' && sdB !== undefined) {
      const ratio = Math.max(sdA, sdB) / Math.min(sdA, sdB)
      if (ratio > 2) {
        warnings.push(
          `The two standard deviations differ by a factor of ${ratio.toFixed(2)}. Pooling them assumes they are estimating the same spread, which they are clearly not — Glass’s delta, against the control group alone, suits this better.`
        )
      }
    }
  } else if (input.measure === 'cramers-v') {
    const table = input.table
    if (table === undefined || table.length < 2 || table[0].length < 2) {
      return fail('invalid-argument', `${facts.label} needs a contingency table of at least two rows and two columns.`)
    }
    const width = table[0].length
    let n = 0
    for (const [i, row] of table.entries()) {
      if (row.length !== width) return fail('invalid-argument', `Row ${i + 1} has ${row.length} cells and the first has ${width}.`)
      for (const [j, cell] of row.entries()) {
        if (!Number.isInteger(cell) || cell < 0) return fail('invalid-argument', `Cell ${i + 1},${j + 1} is ${cell}. These are counts.`)
        n += cell
      }
    }
    if (n === 0) return fail('no-variance', 'Every cell is zero, so there is nothing to measure.')
    const rowTotals = table.map((row) => row.reduce((sum, one) => sum + one, 0))
    const columnTotals = Array.from({ length: width }, (_, j) => table.reduce((sum, row) => sum + row[j], 0))
    let chiSquare = 0
    let smallCells = 0
    for (const [i, row] of table.entries()) {
      for (const [j, cell] of row.entries()) {
        const expected = (rowTotals[i] * columnTotals[j]) / n
        if (expected < 5) smallCells += 1
        if (expected > 0) chiSquare += ((cell - expected) * (cell - expected)) / expected
      }
    }
    const minimumDimension = Math.min(table.length, width) - 1
    value = minimumDimension === 0 ? 0 : Math.sqrt(chiSquare / (n * minimumDimension))
    band = value < 0.1 ? 'negligible' : value < 0.3 ? 'weak' : value < 0.5 ? 'moderate' : 'strong'
    if (smallCells > 0) {
      warnings.push(`${smallCells} cells have an expected count below 5. The chi-square this is built on is unreliable there, and so is V.`)
    }
  } else {
    const table = input.table
    if (table === undefined || table.length !== 2 || table[0].length !== 2 || table[1].length !== 2) {
      return fail('invalid-argument', `${facts.label} needs a two-by-two table: [[exposed with outcome, exposed without], [unexposed with outcome, unexposed without]].`)
    }
    const [[a, b], [c, d]] = table as [[number, number], [number, number]]
    for (const [name, one] of Object.entries({ a, b, c, d })) {
      if (!Number.isInteger(one) || one < 0) return fail('invalid-argument', `Cell ${name} is ${one}. These are counts.`)
    }

    if (input.measure === 'odds-ratio') {
      if (b === 0 || c === 0 || a === 0 || d === 0) {
        warnings.push('A zero cell makes the odds ratio infinite or zero. The usual fix is to add 0.5 to every cell, which is a choice and is not applied here — the raw counts are what they are.')
      }
      if (b === 0 || c === 0) {
        return fail('no-solution', 'A zero in the denominator makes the odds ratio infinite. That is a real feature of the data rather than something to be smoothed over silently.')
      }
      value = (a * d) / (b * c)
      const se = Math.sqrt(1 / Math.max(a, 0.5) + 1 / Math.max(b, 0.5) + 1 / Math.max(c, 0.5) + 1 / Math.max(d, 0.5))
      interval = { low: Math.exp(Math.log(value) - 1.96 * se), high: Math.exp(Math.log(value) + 1.96 * se) }
      const riskExposed = a / Math.max(a + b, 1)
      const riskUnexposed = c / Math.max(c + d, 1)
      const riskRatio = riskUnexposed === 0 ? Number.NaN : riskExposed / riskUnexposed
      if (Number.isFinite(riskRatio) && Math.abs(value - riskRatio) > 0.2 * Math.max(1, riskRatio)) {
        warnings.push(
          `The odds ratio is ${value.toFixed(3)} and the risk ratio is ${riskRatio.toFixed(3)}. They diverge because the outcome is common here, and the odds ratio is always the more extreme of the two — reading it as a risk ratio overstates the effect.`
        )
      }
      band = value > 3 || value < 1 / 3 ? 'large' : value > 1.5 || value < 1 / 1.5 ? 'moderate' : 'small'
    } else {
      const riskExposed = a + b === 0 ? 0 : a / (a + b)
      const riskUnexposed = c + d === 0 ? 0 : c / (c + d)
      if (riskUnexposed === 0) {
        return fail('no-solution', 'Nobody unexposed had the outcome, so the risk ratio is infinite. That is what the data says.')
      }
      value = riskExposed / riskUnexposed
      const se = Math.sqrt(1 / Math.max(a, 0.5) - 1 / Math.max(a + b, 1) + 1 / Math.max(c, 0.5) - 1 / Math.max(c + d, 1))
      interval = { low: Math.exp(Math.log(value) - 1.96 * se), high: Math.exp(Math.log(value) + 1.96 * se) }
      const difference = riskExposed - riskUnexposed
      numberNeededToTreat = difference === 0 ? null : Math.abs(1 / difference)
      band = value > 3 || value < 1 / 3 ? 'large' : value > 1.5 || value < 1 / 1.5 ? 'moderate' : 'small'
    }
  }

  const notes: string[] = [
    `${facts.label}: ${value.toFixed(4)} — ${band}. ${facts.useWhen}`,
    `Caution: ${facts.caution}`,
    'An effect size answers a different question from a significance test. A tiny effect in a large sample is significant and unimportant; a large one in a small sample may be neither significant nor absent.',
    'The bands are conventional and arbitrary. Cohen described them as a last resort when nothing better was available, and they are routinely quoted as though they were findings.'
  ]
  if (overlap !== null) {
    notes.push(
      `The two distributions overlap by about ${(overlap * 100).toFixed(1)}%. That is the same fact as the effect size and it is far more legible — an effect of 0.5 still means four people in five could be either group.`
    )
  }
  if (numberNeededToTreat !== null) {
    notes.push(`Number needed to treat: about ${numberNeededToTreat.toFixed(1)}. That is how many would have to be treated for one extra outcome, and it makes a relative risk concrete.`)
  }
  if (interval !== null) {
    notes.push(
      `95% interval from ${interval.low.toFixed(4)} to ${interval.high.toFixed(4)}. The width matters as much as the point estimate, and a wide interval crossing no effect is a different result from a narrow one.`
    )
  }

  return {
    measure: input.measure,
    label: facts.label,
    value,
    interval,
    band,
    useWhen: facts.useWhen,
    caution: facts.caution,
    overlap,
    numberNeededToTreat,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

/** Abramowitz and Stegun 7.1.26, accurate to about 1.5e-7 — enough for an overlap figure quoted to a percent. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return sign * y
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const MEASURE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Raw agreement and agreement beyond chance are always reported together, because the gap between them is usually the finding.',
  'Cronbach’s alpha measures covariance among items, not whether they measure one thing. It rises with the number of items whatever they are.',
  'Reliability is not validity. A consistent scale can measure the wrong thing and no coefficient here can tell you.',
  'Agreement bands and effect-size bands are conventional and arbitrary. Cohen offered his as a last resort and they are quoted as findings.',
  'Item-total correlations and the alpha-if-removed column are reported, because that is where a reverse-coded item nobody reversed shows up.',
  'The Gini coefficient is one number standing for a whole distribution, so quintile and top shares are reported alongside it.',
  'Odds ratios and risk ratios are different quantities, and where they diverge the result says so.',
  'Effect sizes report the overlap between distributions, which is the same fact in a form readers can use.',
  'An effect size and a significance test answer different questions, and neither substitutes for the other.'
])
