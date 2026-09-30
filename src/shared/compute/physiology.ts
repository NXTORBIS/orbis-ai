/**
 * Physiology: body measures, circulation, breathing, and how a substance clears.
 *
 * The shared physiology engine for Orbis Pages. Every equation is named, every reference range is quoted with the
 * population it came from, and nothing here is advice.
 *
 * ## The rule this whole file is built around
 *
 * **These are reference calculations, not clinical judgements.** Every result that touches a person carries that
 * statement, and no result is ever phrased as what someone should do. A body mass index, a metabolic rate, a
 * creatinine clearance and a drug half-life are all arithmetic over numbers somebody measured; the meaning of the
 * arithmetic depends on who they are, what else is true of them, and what the numbers were measured for. This engine
 * computes and describes. It does not diagnose, it does not recommend a dose, and it does not tell anyone their
 * result is fine or not fine.
 *
 * ## Why every equation is named
 *
 * Basal metabolic rate from Mifflin-St Jeor and from Harris-Benedict differ by well over a hundred kilocalories for
 * the same person, and neither is wrong — they are fits to different populations from different decades. A single
 * unnamed number would hide that. So every estimate says which equation produced it, what population it was fitted
 * to, and what the spread was, and where several equations apply they are all reported.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * body mass index   vs  body fat        -- a ratio of mass to height squared against a composition
 * basal rate        vs  daily need      -- rate at complete rest against rate while living
 * estimated         vs  measured        -- a population fit against an individual measurement
 * clearance         vs  filtration      -- how fast a substance leaves against how fast plasma is filtered
 * half-life         vs  duration        -- time to halve the concentration against time until it stops mattering
 * reference range   vs  healthy         -- where the middle 95% of a population sat against anything about a person
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface PhysiologyError {
  error: 'invalid-argument' | 'out-of-range' | 'missing-input' | 'not-applicable'
  message: string
}

export const isPhysiologyError = (value: unknown): value is PhysiologyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: PhysiologyError['error'], message: string): PhysiologyError => ({ error, message })

/** Stated on every result that describes a person. Not decoration. */
export const NOT_CLINICAL =
  'This is a reference calculation over the numbers given, not a clinical judgement. What it means for a particular person depends on who they are and why the numbers were measured, and that is a conversation with a clinician rather than an output of arithmetic.'

// ---------------------------------------------------------------- body measures

export type BiologicalSex = 'male' | 'female'

export interface BodyReport {
  /** kg/m². */
  bodyMassIndex: number
  /** The band the index falls in, with the population the bands came from. */
  indexBand: string
  bandSource: string
  /** m². Body surface area from several named formulas, because they disagree. */
  surfaceArea: readonly { method: string; value: number }[]
  /** kg. Lean body mass from named formulas. */
  leanBodyMass: readonly { method: string; value: number }[]
  /** kg. What the index band would correspond to at this height, as a range rather than a target. */
  indexRangeWeight: { from: number; to: number }
  /** Waist-to-height ratio, when a waist was given — a better predictor than the index and less used. */
  waistToHeight: number | null
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Body measures from height, weight and optionally a waist.
 *
 * Body mass index is computed because it is asked for, and immediately qualified because it is a ratio of mass to
 * height squared and nothing else. It cannot distinguish muscle from fat, it scales wrongly with height — a tall
 * person of identical build gets a higher index — and the bands come from a mid-twentieth-century European and North
 * American population. A muscular athlete and a sedentary person of the same index are not in the same situation and
 * the index cannot tell them apart.
 *
 * Where a waist measurement is given, waist-to-height is reported too. It predicts metabolic risk better than the
 * index in most published comparisons and is far less used, which is worth saying.
 *
 * Surface area comes from four formulas at once because they disagree by several percent, and drug dosing that uses
 * surface area is sensitive to which one was picked.
 */
export function bodyMeasures(input: {
  /** cm. */
  height: number
  /** kg. */
  weight: number
  /** cm. Optional. */
  waist?: number
  sex?: BiologicalSex
  /** Years. Only used to say whether the adult bands apply at all. */
  age?: number
}): BodyReport | PhysiologyError {
  const { height, weight } = input
  if (!Number.isFinite(height) || height <= 0) return fail('invalid-argument', 'Height has to be a positive number of centimetres.')
  if (!Number.isFinite(weight) || weight <= 0) return fail('invalid-argument', 'Weight has to be a positive number of kilograms.')
  if (height < 30 || height > 280) {
    return fail(
      'out-of-range',
      `${height} cm is outside the range this covers. If metres were meant, multiply by 100 — 1.75 m is 175 cm.`
    )
  }
  if (weight > 700) return fail('out-of-range', `${weight} kg is outside the range this covers. If pounds were meant, divide by 2.205.`)
  if (input.waist !== undefined && (!Number.isFinite(input.waist) || input.waist <= 0 || input.waist > 300)) {
    return fail('out-of-range', 'A waist measurement has to be a positive number of centimetres below 300.')
  }

  const metres = height / 100
  const index = weight / (metres * metres)
  const warnings: string[] = []

  const band =
    index < 16
      ? 'below 16'
      : index < 18.5
        ? '16 to 18.5'
        : index < 25
          ? '18.5 to 25'
          : index < 30
            ? '25 to 30'
            : index < 35
              ? '30 to 35'
              : index < 40
                ? '35 to 40'
                : '40 and above'

  if (input.age !== undefined) {
    if (!Number.isFinite(input.age) || input.age < 0 || input.age > 130) return fail('out-of-range', 'An age has to be between 0 and 130 years.')
    if (input.age < 20) {
      warnings.push(
        `At ${input.age} the adult index bands do not apply at all. Body mass index in children and adolescents is read against age-and-sex percentile charts because normal body composition changes month by month through growth, and an adult band gives a meaningless answer.`
      )
    }
    if (input.age >= 65) {
      warnings.push(
        'Above about 65 the relationship between body mass index and outcomes shifts, and several large studies find the lowest mortality at a higher index than in younger adults. The adult bands were not fitted to this age group.'
      )
    }
  }

  warnings.push(
    'Body mass index is mass divided by height squared and nothing else. It cannot distinguish muscle from fat, and because it divides by height squared rather than cubed it reads high for tall people and low for short people of identical build.'
  )

  const surfaceArea = [
    { method: 'Du Bois and Du Bois (1916)', value: 0.007184 * Math.pow(height, 0.725) * Math.pow(weight, 0.425) },
    { method: 'Mosteller (1987)', value: Math.sqrt((height * weight) / 3600) },
    { method: 'Haycock (1978)', value: 0.024265 * Math.pow(height, 0.3964) * Math.pow(weight, 0.5378) },
    { method: 'Gehan and George (1970)', value: 0.0235 * Math.pow(height, 0.42246) * Math.pow(weight, 0.51456) }
  ]
  const areaSpread = Math.max(...surfaceArea.map((one) => one.value)) - Math.min(...surfaceArea.map((one) => one.value))
  if (areaSpread / surfaceArea[1].value > 0.03) {
    warnings.push(
      `The four surface area formulas span ${areaSpread.toFixed(3)} m², which is ${((areaSpread / surfaceArea[1].value) * 100).toFixed(1)}% of the Mosteller value. Anything dosed by surface area inherits that disagreement, so the formula has to be stated rather than assumed.`
    )
  }

  const leanBodyMass: { method: string; value: number }[] = []
  if (input.sex !== undefined) {
    if (input.sex !== 'male' && input.sex !== 'female') return fail('invalid-argument', 'Sex is "male" or "female" for the purposes of these equations, which were fitted separately.')
    // Boer, 1984.
    leanBodyMass.push({
      method: 'Boer (1984)',
      value: input.sex === 'male' ? 0.407 * weight + 0.267 * height - 19.2 : 0.252 * weight + 0.473 * height - 48.3
    })
    // Hume, 1966.
    leanBodyMass.push({
      method: 'Hume (1966)',
      value: input.sex === 'male' ? 0.32810 * weight + 0.33929 * height - 29.5336 : 0.29569 * weight + 0.41813 * height - 43.2933
    })
    for (const one of leanBodyMass) {
      if (one.value <= 0 || one.value > weight) {
        warnings.push(
          `The ${one.method} lean mass equation gives ${one.value.toFixed(1)} kg, which is ${one.value <= 0 ? 'negative' : 'more than the total body weight'}. These are linear fits to a middle range and they break outside it — the equation is being applied where it does not hold.`
        )
      }
    }
  } else {
    warnings.push('Lean body mass equations were fitted separately by sex, so without one they were not computed rather than being computed with a guess.')
  }

  return {
    bodyMassIndex: index,
    indexBand: band,
    bandSource:
      'The adult bands come from World Health Organization cut-points derived largely from mid-twentieth-century European and North American populations. Several countries use lower cut-points for South Asian and East Asian populations, where metabolic risk rises at a lower index.',
    surfaceArea: Object.freeze(surfaceArea),
    leanBodyMass: Object.freeze(leanBodyMass),
    indexRangeWeight: { from: 18.5 * metres * metres, to: 25 * metres * metres },
    waistToHeight: input.waist !== undefined ? input.waist / height : null,
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      `Body mass index ${index.toFixed(2)} kg/m², in the ${band} band.`,
      `At ${height} cm the 18.5 to 25 band spans ${(18.5 * metres * metres).toFixed(1)} to ${(25 * metres * metres).toFixed(1)} kg. That is a band, not a target.`,
      input.waist !== undefined
        ? `Waist-to-height ratio ${(input.waist / height).toFixed(3)}. This predicts metabolic risk better than the index in most published comparisons, and is far less used — partly because it needs a tape measure held in a consistent place.`
        : 'No waist measurement was given. Waist-to-height is a better predictor of metabolic risk than body mass index and needs only a tape measure.',
      `Surface area by Mosteller ${surfaceArea[1].value.toFixed(3)} m². The four formulas are all reported because they disagree and anything dosed by surface area inherits the disagreement.`,
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface MetabolicReport {
  /** kcal/day at complete rest, from each named equation. */
  basalRate: readonly { method: string; value: number; population: string }[]
  /** The spread between equations, which is the honest uncertainty. */
  spread: number
  /** kcal/day including activity, from the equation chosen as the default. */
  dailyNeed: number | null
  activityFactor: number | null
  activityLabel: string | null
  /** kcal/day, the difference a stated change in weight would need over a stated period. */
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

const ACTIVITY_LEVELS = Object.freeze({
  sedentary: { factor: 1.2, label: 'desk work and little deliberate movement' },
  light: { factor: 1.375, label: 'light exercise one to three days a week' },
  moderate: { factor: 1.55, label: 'moderate exercise three to five days a week' },
  active: { factor: 1.725, label: 'hard exercise six or seven days a week' },
  'very-active': { factor: 1.9, label: 'hard daily exercise, or physical work' }
})

export type ActivityLevel = keyof typeof ACTIVITY_LEVELS

/**
 * Basal metabolic rate from every equation that applies, and a daily need if an activity level is given.
 *
 * All the equations are reported because they disagree by well over a hundred kilocalories for the same person, and
 * none of them is wrong — they are fits to different populations measured decades apart. Mifflin-St Jeor is used for
 * the daily need because it performs best against measured rates in modern populations, and that choice is stated
 * rather than hidden.
 *
 * The activity factors are the coarsest part of this by a long way. They are five buckets standing in for everything
 * a person does all day, and the honest error on a daily need is larger than the disagreement between the basal
 * equations.
 */
export function metabolicRate(input: {
  /** kg. */
  weight: number
  /** cm. */
  height: number
  /** Years. */
  age: number
  sex: BiologicalSex
  activity?: ActivityLevel
  /** kg. Lean body mass, which makes the Katch-McArdle equation available and is the better basis. */
  leanBodyMass?: number
}): MetabolicReport | PhysiologyError {
  const { weight, height, age, sex } = input
  if (!Number.isFinite(weight) || weight <= 0 || weight > 700) return fail('out-of-range', 'Weight has to be a positive number of kilograms below 700.')
  if (!Number.isFinite(height) || height < 30 || height > 280) return fail('out-of-range', 'Height has to be between 30 and 280 centimetres.')
  if (!Number.isFinite(age) || age < 0 || age > 130) return fail('out-of-range', 'Age has to be between 0 and 130 years.')
  if (sex !== 'male' && sex !== 'female') return fail('invalid-argument', 'Sex is "male" or "female" here, because every one of these equations was fitted separately.')

  const warnings: string[] = []
  if (age < 18) {
    warnings.push(
      `At ${age} these equations do not apply. Every one of them was fitted to adults, and a growing body spends energy on growth that none of them accounts for.`
    )
  }

  const basalRate: MetabolicReport['basalRate'][number][] = [
    {
      method: 'Mifflin-St Jeor (1990)',
      value: 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161),
      population: 'Fitted to 498 adults in Nevada, and the equation that performs best against measured rates in modern populations. Typical error around 10% for an individual.'
    },
    {
      method: 'Harris-Benedict, revised (1984)',
      value:
        sex === 'male'
          ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
          : 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age,
      population: 'The 1919 original revised by Roza and Shizgal. Tends to read high for people carrying more weight, because the original sample did not include many.'
    },
    {
      method: 'Schofield (1985)',
      value: (() => {
        // The FAO/WHO tables, by age band and sex. Held as the piecewise fit it is.
        if (sex === 'male') {
          if (age < 3) return 59.512 * weight - 30.4
          if (age < 10) return 22.706 * weight + 504.3
          if (age < 18) return 17.686 * weight + 658.2
          if (age < 30) return 15.057 * weight + 692.2
          if (age < 60) return 11.472 * weight + 873.1
          return 11.711 * weight + 587.7
        }
        if (age < 3) return 58.317 * weight - 31.1
        if (age < 10) return 20.315 * weight + 485.9
        if (age < 18) return 13.384 * weight + 692.6
        if (age < 30) return 14.818 * weight + 486.6
        if (age < 60) return 8.126 * weight + 845.6
        return 9.082 * weight + 658.5
      })(),
      population: 'The FAO/WHO/UNU tables, weight and age band only. Used in dietary guidelines and covers children, unlike the others.'
    }
  ]

  if (input.leanBodyMass !== undefined) {
    if (!Number.isFinite(input.leanBodyMass) || input.leanBodyMass <= 0) {
      return fail('invalid-argument', 'Lean body mass has to be a positive number of kilograms.')
    }
    if (input.leanBodyMass > weight) {
      return fail('invalid-argument', `Lean body mass of ${input.leanBodyMass} kg is more than the total weight of ${weight} kg.`)
    }
    basalRate.push({
      method: 'Katch-McArdle (1996)',
      value: 370 + 21.6 * input.leanBodyMass,
      population:
        'Uses lean mass instead of total weight, so it needs no sex term — the sex difference in the other equations is largely a difference in body composition. The best of these when lean mass is actually measured rather than estimated.'
    })
  }

  const values = basalRate.map((one) => one.value)
  const spread = Math.max(...values) - Math.min(...values)
  if (spread > 100) {
    warnings.push(
      `The equations span ${spread.toFixed(0)} kcal/day for this person. None of them is wrong — they are fits to different populations from different decades — and that spread is the honest uncertainty on any single figure.`
    )
  }

  let dailyNeed: number | null = null
  let activityFactor: number | null = null
  let activityLabel: string | null = null
  if (input.activity !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(ACTIVITY_LEVELS, input.activity)) {
      return fail('invalid-argument', `Activity level is one of ${Object.keys(ACTIVITY_LEVELS).join(', ')}.`)
    }
    const level = ACTIVITY_LEVELS[input.activity]
    activityFactor = level.factor
    activityLabel = level.label
    dailyNeed = basalRate[0].value * level.factor
    warnings.push(
      'The activity factors are five buckets standing in for everything a person does all day, and they are by far the coarsest part of this. The honest error on a daily need is larger than the disagreement between the basal equations.'
    )
  }

  return {
    basalRate: Object.freeze(basalRate),
    spread,
    dailyNeed,
    activityFactor,
    activityLabel,
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      `${basalRate.map((one) => `${one.method}: ${one.value.toFixed(0)} kcal/day`).join('; ')}.`,
      `Every equation is reported because they disagree by ${spread.toFixed(0)} kcal/day here, and a single unnamed number would hide that.`,
      dailyNeed === null
        ? 'No activity level was given, so only the resting rate is shown. A basal rate is what the body spends lying still and awake — it is not a daily requirement.'
        : `With the ${input.activity} factor of ${activityFactor}, about ${dailyNeed.toFixed(0)} kcal/day. Mifflin-St Jeor was used for this, because it performs best against measured rates in modern populations.`,
      'A basal rate is the rate at complete rest. A daily need includes moving, digesting and staying warm, which is why the two differ by 20 to 90 per cent.',
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- circulation and breathing

export interface CirculationReport {
  /** L/min. */
  cardiacOutput: number
  /** L/min/m², when a surface area was given. The figure that is actually comparable between people. */
  cardiacIndex: number | null
  /** mL. */
  strokeVolume: number
  /** mmHg. */
  meanArterialPressure: number | null
  pulsePressure: number | null
  /** dyn·s/cm⁵, when a pressure and a venous pressure were given. */
  systemicResistance: number | null
  /** The reference range for each figure, with its population. */
  reference: readonly { name: string; range: string; population: string }[]
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Cardiac output and the pressures around it.
 *
 * The mean arterial pressure is computed as diastolic plus a third of the pulse pressure, which is the standard
 * approximation and is stated as one: it assumes the heart spends about a third of each cycle in systole, which
 * stops being true as the rate rises. At 150 beats a minute the approximation is noticeably wrong and the real mean
 * is higher than it gives.
 *
 * Cardiac index rather than cardiac output is what compares between people, because a 50 kg person and a 100 kg
 * person need very different outputs to be in the same state. Where no surface area is given, that is said rather
 * than the raw output being offered as though it were comparable.
 */
export function circulation(input: {
  /** mL. Volume ejected per beat. Give this or the cardiac output. */
  strokeVolume?: number
  /** L/min. */
  cardiacOutput?: number
  /** Beats per minute. */
  heartRate: number
  /** mmHg. */
  systolic?: number
  diastolic?: number
  /** m². Turns output into index. */
  surfaceArea?: number
  /** mmHg. Central venous pressure, for the resistance. */
  venousPressure?: number
}): CirculationReport | PhysiologyError {
  const { heartRate } = input
  if (!Number.isFinite(heartRate) || heartRate <= 0) return fail('invalid-argument', 'Heart rate has to be a positive number of beats per minute.')
  if (heartRate > 300) return fail('out-of-range', `${heartRate} beats per minute is outside the range this covers.`)

  let strokeVolume: number
  let cardiacOutput: number
  if (input.strokeVolume !== undefined) {
    if (!Number.isFinite(input.strokeVolume) || input.strokeVolume <= 0) return fail('invalid-argument', 'Stroke volume has to be a positive number of millilitres.')
    strokeVolume = input.strokeVolume
    cardiacOutput = (strokeVolume * heartRate) / 1000
  } else if (input.cardiacOutput !== undefined) {
    if (!Number.isFinite(input.cardiacOutput) || input.cardiacOutput <= 0) return fail('invalid-argument', 'Cardiac output has to be a positive number of litres per minute.')
    cardiacOutput = input.cardiacOutput
    strokeVolume = (cardiacOutput * 1000) / heartRate
  } else {
    return fail('missing-input', 'Give either a stroke volume in millilitres or a cardiac output in litres per minute. Output is stroke volume times heart rate, so either one plus the rate gives the other.')
  }

  const warnings: string[] = []
  let meanArterial: number | null = null
  let pulsePressure: number | null = null
  if (input.systolic !== undefined || input.diastolic !== undefined) {
    if (input.systolic === undefined || input.diastolic === undefined) {
      return fail('missing-input', 'Give both the systolic and the diastolic pressure, or neither.')
    }
    if (!Number.isFinite(input.systolic) || !Number.isFinite(input.diastolic)) return fail('invalid-argument', 'Both pressures have to be numbers in mmHg.')
    if (input.systolic <= input.diastolic) {
      return fail(
        'invalid-argument',
        `The systolic pressure (${input.systolic}) has to be above the diastolic (${input.diastolic}). If they were entered the other way round, swap them.`
      )
    }
    if (input.systolic > 300 || input.diastolic < 0) return fail('out-of-range', 'The pressures are outside the range this covers.')
    pulsePressure = input.systolic - input.diastolic
    meanArterial = input.diastolic + pulsePressure / 3
    warnings.push(
      'The mean arterial pressure uses diastolic plus a third of the pulse pressure. That assumes the heart spends about a third of each cycle in systole, which stops being true as the rate rises — above about 120 beats a minute the real mean is higher than this gives.'
    )
    if (heartRate > 120) {
      warnings.push(`At ${heartRate} beats a minute the one-third approximation is noticeably wrong, and the mean of ${meanArterial.toFixed(1)} mmHg is an underestimate.`)
    }
  }

  let resistance: number | null = null
  if (meanArterial !== null && input.venousPressure !== undefined) {
    if (!Number.isFinite(input.venousPressure)) return fail('invalid-argument', 'Central venous pressure has to be a number in mmHg.')
    if (input.venousPressure >= meanArterial) {
      return fail(
        'invalid-argument',
        `The venous pressure (${input.venousPressure} mmHg) is at or above the mean arterial pressure (${meanArterial.toFixed(1)} mmHg). Blood flows down that gradient, so with no gradient there is no flow and a resistance cannot be formed.`
      )
    }
    resistance = ((meanArterial - input.venousPressure) * 80) / cardiacOutput
  }

  let cardiacIndex: number | null = null
  if (input.surfaceArea !== undefined) {
    if (!Number.isFinite(input.surfaceArea) || input.surfaceArea <= 0 || input.surfaceArea > 4) {
      return fail('out-of-range', 'Body surface area has to be a positive number of square metres below 4.')
    }
    cardiacIndex = cardiacOutput / input.surfaceArea
  } else {
    warnings.push(
      'No surface area was given, so no cardiac index. Output alone does not compare between people — a 50 kg person and a 100 kg person need very different outputs to be in the same state, which is exactly what the index corrects for.'
    )
  }

  return {
    cardiacOutput,
    cardiacIndex,
    strokeVolume,
    meanArterialPressure: meanArterial,
    pulsePressure,
    systemicResistance: resistance,
    reference: Object.freeze([
      {
        name: 'cardiac output',
        range: '4 to 8 L/min',
        population: 'Resting adults. Depends strongly on body size, which is why the index is the comparable figure.'
      },
      { name: 'cardiac index', range: '2.5 to 4.0 L/min/m²', population: 'Resting adults, corrected for body size.' },
      { name: 'stroke volume', range: '60 to 100 mL', population: 'Resting adults.' },
      {
        name: 'mean arterial pressure',
        range: '70 to 100 mmHg',
        population: 'Resting adults. Below about 60 organ perfusion is generally considered inadequate, which is a statement about populations and not about a person.'
      }
    ]),
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      `Cardiac output ${cardiacOutput.toFixed(3)} L/min from a stroke volume of ${strokeVolume.toFixed(1)} mL at ${heartRate} beats per minute.`,
      cardiacIndex === null ? 'No cardiac index computed.' : `Cardiac index ${cardiacIndex.toFixed(3)} L/min/m², which is the figure that compares between people.`,
      meanArterial === null
        ? 'No pressures were given.'
        : `Pulse pressure ${(pulsePressure as number).toFixed(0)} mmHg, mean arterial pressure about ${meanArterial.toFixed(1)} mmHg.`,
      'Output is stroke volume times rate, so a falling stroke volume can be hidden by a rising rate — which is exactly what the body does, and why a normal output does not mean a normal heart.',
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface RespiratoryReport {
  /** mL/min. Total air moved. */
  minuteVentilation: number
  /** mL/min. Air reaching gas exchange, which is the part that does anything. */
  alveolarVentilation: number
  /** mL. Dead space, estimated or given. */
  deadSpace: number
  deadSpaceEstimated: boolean
  /** The fraction of each breath that is wasted. */
  deadSpaceFraction: number
  /** L. Predicted forced expiratory volume and vital capacity, where the inputs allow. */
  predicted: { fev1: number; vitalCapacity: number; ratio: number; source: string } | null
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Ventilation, split into the part that reaches gas exchange and the part that does not.
 *
 * This split is the whole point and it is counter-intuitive. Breathing shallowly and fast can move the same total
 * air as breathing deeply and slowly while delivering far less to the alveoli, because the dead space is paid on
 * every breath regardless of how big it is. Twelve breaths of 500 mL and 24 breaths of 250 mL are both 6 L/min of
 * minute ventilation, and the second delivers almost nothing.
 */
export function ventilation(input: {
  /** mL. Volume of one breath. */
  tidalVolume: number
  /** Breaths per minute. */
  respiratoryRate: number
  /** mL. Anatomical dead space. Estimated from weight if not given. */
  deadSpace?: number
  /** kg. Used only to estimate dead space. */
  weight?: number
  /** cm, years, sex — for the predicted spirometry values. */
  height?: number
  age?: number
  sex?: BiologicalSex
}): RespiratoryReport | PhysiologyError {
  const { tidalVolume, respiratoryRate } = input
  if (!Number.isFinite(tidalVolume) || tidalVolume <= 0) return fail('invalid-argument', 'Tidal volume has to be a positive number of millilitres.')
  if (!Number.isFinite(respiratoryRate) || respiratoryRate <= 0) return fail('invalid-argument', 'Respiratory rate has to be a positive number of breaths per minute.')
  if (tidalVolume > 5000) return fail('out-of-range', `${tidalVolume} mL in one breath is outside the range this covers. If litres were meant, multiply by 1000.`)
  if (respiratoryRate > 120) return fail('out-of-range', `${respiratoryRate} breaths per minute is outside the range this covers.`)

  const warnings: string[] = []
  let deadSpace: number
  let estimated = false
  if (input.deadSpace !== undefined) {
    if (!Number.isFinite(input.deadSpace) || input.deadSpace < 0) return fail('invalid-argument', 'Dead space cannot be negative.')
    deadSpace = input.deadSpace
  } else if (input.weight !== undefined) {
    if (!Number.isFinite(input.weight) || input.weight <= 0) return fail('invalid-argument', 'Weight has to be a positive number of kilograms.')
    deadSpace = 2.2 * input.weight
    estimated = true
    warnings.push(
      `Dead space was estimated as 2.2 mL per kilogram, giving ${deadSpace.toFixed(0)} mL. That rule of thumb is anatomical dead space only — it does not include alveoli that are ventilated but not perfused, which is what makes physiological dead space larger and is exactly what changes in lung disease.`
    )
  } else {
    return fail('missing-input', 'Give either a dead space in millilitres or a body weight, which lets it be estimated at 2.2 mL per kilogram.')
  }

  if (deadSpace >= tidalVolume) {
    return fail(
      'not-applicable',
      `The dead space (${deadSpace.toFixed(0)} mL) is at or above the tidal volume (${tidalVolume} mL), so no air reaches gas exchange at all and alveolar ventilation is zero. That is a real and immediately dangerous situation rather than an arithmetic result, and it is being refused as a calculation rather than reported as a negative number.`
    )
  }

  const minute = tidalVolume * respiratoryRate
  const alveolar = (tidalVolume - deadSpace) * respiratoryRate
  const fraction = deadSpace / tidalVolume

  if (fraction > 0.5) {
    warnings.push(
      `${(fraction * 100).toFixed(0)}% of each breath never reaches gas exchange. The dead space is paid on every breath whatever its size, which is why shallow fast breathing moves the same total air as deep slow breathing while delivering far less.`
    )
  }

  let predicted: RespiratoryReport['predicted'] = null
  if (input.height !== undefined && input.age !== undefined && input.sex !== undefined) {
    if (!Number.isFinite(input.height) || input.height < 100 || input.height > 250) return fail('out-of-range', 'Height for predicted spirometry has to be between 100 and 250 centimetres.')
    if (!Number.isFinite(input.age) || input.age < 18 || input.age > 100) {
      return fail('out-of-range', 'The predicted spirometry equations were fitted to adults aged 18 to 100.')
    }
    if (input.sex !== 'male' && input.sex !== 'female') return fail('invalid-argument', 'Sex is "male" or "female" for these equations.')
    // The European Community for Coal and Steel (ECCS) 1993 reference equations, which are the widely quoted ones.
    const fev1 =
      input.sex === 'male'
        ? 4.3 * (input.height / 100) - 0.029 * input.age - 2.49
        : 3.95 * (input.height / 100) - 0.025 * input.age - 2.6
    const vitalCapacity =
      input.sex === 'male'
        ? 5.76 * (input.height / 100) - 0.026 * input.age - 4.34
        : 4.43 * (input.height / 100) - 0.026 * input.age - 2.89
    predicted = {
      fev1,
      vitalCapacity,
      ratio: vitalCapacity === 0 ? 0 : fev1 / vitalCapacity,
      source:
        'The ECCS 1993 reference equations, fitted to a European adult population. Reference values differ between populations by 10% or more, so a predicted value from the wrong reference set is a systematic error in one direction. Modern practice uses the GLI 2012 equations with an explicit ethnic term, which need a lookup table this does not carry.'
    }
    warnings.push(
      'Predicted spirometry values are population averages with a wide spread — the lower limit of normal is roughly 80% of predicted, and that band is what a single predicted number hides.'
    )
  }

  return {
    minuteVentilation: minute,
    alveolarVentilation: alveolar,
    deadSpace,
    deadSpaceEstimated: estimated,
    deadSpaceFraction: fraction,
    predicted,
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      `Minute ventilation ${(minute / 1000).toFixed(3)} L/min, of which ${(alveolar / 1000).toFixed(3)} L/min reaches gas exchange — ${((alveolar / minute) * 100).toFixed(1)}% of the total.`,
      `${(fraction * 100).toFixed(1)}% of each breath is dead space, paid once per breath regardless of the breath size.`,
      `The same ${(minute / 1000).toFixed(2)} L/min at half the tidal volume and double the rate would deliver ${(((tidalVolume / 2 - deadSpace) * respiratoryRate * 2) / 1000).toFixed(3)} L/min to the alveoli. Minute ventilation is the number that gets quoted and alveolar ventilation is the one that matters.`,
      predicted === null ? 'No predicted spirometry values; those need height, age and sex.' : predicted.source,
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- clearance and dosing

export interface ClearanceReport {
  /** mL/min. Estimated creatinine clearance by Cockcroft-Gault. */
  cockcroftGault: number | null
  /** mL/min/1.73 m². Estimated filtration rate by CKD-EPI 2021. */
  ckdEpi: number | null
  /** The band each falls in, which is a description and not a diagnosis. */
  stage: string | null
  /** The two estimates side by side, because they estimate different quantities. */
  comparison: string
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Estimated kidney function from creatinine, by two named equations that estimate different things.
 *
 * Cockcroft-Gault estimates creatinine clearance in mL/min and CKD-EPI estimates glomerular filtration rate
 * normalised to 1.73 m² of body surface. They are not the same quantity, they are not interchangeable, and which one
 * a given dosing table was built against matters. Both are reported with what each one is.
 *
 * Creatinine comes from muscle, so both equations read high — meaning they overestimate kidney function — in anyone
 * with little muscle: the very old, the very thin, someone with a limb amputated, anyone bedbound. That is the most
 * consequential limitation of both and it is stated on every result.
 *
 * The 2021 CKD-EPI equation is used because it removed the race coefficient the 2009 version carried. That
 * coefficient had no physiological basis and systematically reported higher function for Black patients, which
 * delayed referrals and transplant listings.
 */
export function kidneyFunction(input: {
  /** mg/dL. */
  creatinine: number
  /** Years. */
  age: number
  sex: BiologicalSex
  /** kg. Needed for Cockcroft-Gault, which is a clearance in mL/min and therefore size-dependent. */
  weight?: number
}): ClearanceReport | PhysiologyError {
  const { creatinine, age, sex } = input
  if (!Number.isFinite(creatinine) || creatinine <= 0) return fail('invalid-argument', 'Serum creatinine has to be a positive number in mg/dL.')
  if (creatinine > 30) {
    return fail('out-of-range', `${creatinine} mg/dL is outside the range this covers. If micromoles per litre were meant, divide by 88.4 — 88 umol/L is about 1.0 mg/dL.`)
  }
  if (creatinine < 0.2) {
    return fail(
      'out-of-range',
      `${creatinine} mg/dL is below the range these equations were fitted to. A value that low usually means very little muscle rather than excellent kidney function, and both equations would read absurdly high.`
    )
  }
  if (!Number.isFinite(age) || age < 18 || age > 120) {
    return fail('out-of-range', 'Both equations were fitted to adults. Kidney function in children is estimated by different equations entirely, and applying an adult one gives a wrong answer confidently.')
  }
  if (sex !== 'male' && sex !== 'female') return fail('invalid-argument', 'Sex is "male" or "female" for these equations, which were fitted with a sex term.')

  const warnings: string[] = [
    'Creatinine comes from muscle, so both equations overestimate kidney function in anyone with little of it — the very old, the very thin, someone with a limb amputated, anyone bedbound. That is the most consequential limitation of both and it does not show up in the number.',
    'Both are estimates from a single blood value at a single moment. Neither can detect function that is changing, and in someone whose kidneys are failing rapidly the creatinine lags days behind, so the estimate reads better than the reality.'
  ]

  let cockcroftGault: number | null = null
  if (input.weight !== undefined) {
    if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 700) return fail('out-of-range', 'Weight has to be a positive number of kilograms below 700.')
    cockcroftGault = ((140 - age) * input.weight * (sex === 'female' ? 0.85 : 1)) / (72 * creatinine)
  } else {
    warnings.push('No weight was given, so no Cockcroft-Gault estimate. It is a clearance in mL/min and therefore depends on body size, which is why it needs one.')
  }

  // CKD-EPI 2021, without the race coefficient the 2009 version carried.
  const kappa = sex === 'female' ? 0.7 : 0.9
  const alpha = sex === 'female' ? -0.241 : -0.302
  const ratio = creatinine / kappa
  const ckdEpi =
    142 *
    Math.pow(Math.min(ratio, 1), alpha) *
    Math.pow(Math.max(ratio, 1), -1.2) *
    Math.pow(0.9938, age) *
    (sex === 'female' ? 1.012 : 1)

  const stage =
    ckdEpi >= 90
      ? '90 or above'
      : ckdEpi >= 60
        ? '60 to 89'
        : ckdEpi >= 45
          ? '45 to 59'
          : ckdEpi >= 30
            ? '30 to 44'
            : ckdEpi >= 15
              ? '15 to 29'
              : 'below 15'

  if (cockcroftGault !== null && Math.abs(cockcroftGault - ckdEpi) / ckdEpi > 0.25) {
    warnings.push(
      `The two estimates differ by ${(Math.abs(cockcroftGault - ckdEpi) / ckdEpi * 100).toFixed(0)}% — ${cockcroftGault.toFixed(1)} against ${ckdEpi.toFixed(1)}. They estimate different quantities in different units, so a gap is expected, and it is widest at the extremes of body size. Which one a dosing table was built against is not a detail.`
    )
  }

  return {
    cockcroftGault,
    ckdEpi,
    stage,
    comparison:
      'Cockcroft-Gault gives creatinine clearance in mL/min, which depends on body size. CKD-EPI gives glomerular filtration rate per 1.73 m² of body surface, which does not. They are different quantities, not two attempts at one, and most drug dosing tables were built against Cockcroft-Gault because it is older.',
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      cockcroftGault === null
        ? `CKD-EPI 2021 estimate ${ckdEpi.toFixed(1)} mL/min/1.73 m².`
        : `Cockcroft-Gault ${cockcroftGault.toFixed(1)} mL/min, CKD-EPI 2021 ${ckdEpi.toFixed(1)} mL/min/1.73 m².`,
      `The CKD-EPI value falls in the ${stage} band. Those bands are descriptive categories used in guidelines, and a band is not a diagnosis — staging chronic kidney disease needs a value sustained over at least three months plus evidence of kidney damage, not one blood test.`,
      'The 2021 CKD-EPI equation is used because it removed the race coefficient the 2009 version carried. That coefficient had no physiological basis and systematically reported higher function for Black patients, which delayed referrals and transplant listings.',
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface PharmacokineticsReport {
  /** Hours. */
  halfLife: number
  /** Per hour. */
  eliminationConstant: number
  /** L. */
  volumeOfDistribution: number | null
  /** L/h. */
  clearance: number | null
  /** How long until effectively all of it is gone, and what "effectively" means. */
  practicallyCleared: { hours: number; halfLives: number; remainingFraction: number }
  /** Hours. Time to reach a steady concentration on repeated dosing. */
  timeToSteadyState: number
  /** The concentration over time, as a trace. */
  trace: readonly { hours: number; fraction: number }[]
  /** On repeated dosing, the peak and trough at steady state relative to one dose. */
  steadyState: { peakFactor: number; troughFactor: number; accumulationFactor: number; interval: number } | null
  notClinical: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * First-order elimination: half-life, clearance, and what happens on repeated dosing.
 *
 * The accumulation factor is the output that surprises people and it is pure arithmetic: dosing at intervals shorter
 * than the half-life makes the drug pile up, and the steady-state level is the single-dose level multiplied by
 * 1/(1 − e^(−kτ)). Dosing every half-life doubles it. Dosing every quarter half-life multiplies it by about five.
 *
 * Everything here assumes first-order elimination, meaning a constant fraction leaves per unit time. Several
 * important substances do not work that way — alcohol and phenytoin saturate their clearing enzymes and leave at a
 * roughly constant *amount* per hour instead — and for those every number here is wrong. That is stated rather than
 * left implied.
 */
export function pharmacokinetics(input: {
  /** Hours. Give this or the elimination constant. */
  halfLife?: number
  /** Per hour. */
  eliminationConstant?: number
  /** L. */
  volumeOfDistribution?: number
  /** Hours. The dosing interval, for the accumulation figures. */
  dosingInterval?: number
  /** How small a remaining fraction counts as cleared. Defaults to 3%, which is five half-lives. */
  clearedThreshold?: number
}): PharmacokineticsReport | PhysiologyError {
  let halfLife: number
  if (input.halfLife !== undefined) {
    if (!Number.isFinite(input.halfLife) || input.halfLife <= 0) return fail('invalid-argument', 'Half-life has to be a positive number of hours.')
    halfLife = input.halfLife
  } else if (input.eliminationConstant !== undefined) {
    if (!Number.isFinite(input.eliminationConstant) || input.eliminationConstant <= 0) {
      return fail('invalid-argument', 'The elimination constant has to be positive, in units of per hour.')
    }
    halfLife = Math.LN2 / input.eliminationConstant
  } else {
    return fail('missing-input', 'Give either a half-life in hours or an elimination constant per hour. They are the same fact: the constant is ln(2) divided by the half-life.')
  }
  if (halfLife > 100_000) return fail('out-of-range', 'That half-life is longer than this handles.')

  const k = Math.LN2 / halfLife
  const warnings: string[] = [
    'Everything here assumes first-order elimination: a constant fraction leaves per unit time. Alcohol and phenytoin saturate the enzymes that clear them and leave at a roughly constant amount per hour instead, and for those every figure here is wrong rather than approximate.'
  ]

  const threshold = input.clearedThreshold ?? 0.03
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    return fail('out-of-range', 'The cleared threshold is a remaining fraction between 0 and 1, exclusive. Nothing ever reaches exactly zero under first-order elimination, which is why a threshold is needed at all.')
  }
  const halfLivesToClear = Math.log(1 / threshold) / Math.LN2
  const hoursToClear = halfLivesToClear * halfLife

  let volume: number | null = null
  let clearance: number | null = null
  if (input.volumeOfDistribution !== undefined) {
    if (!Number.isFinite(input.volumeOfDistribution) || input.volumeOfDistribution <= 0) {
      return fail('invalid-argument', 'The volume of distribution has to be positive, in litres.')
    }
    volume = input.volumeOfDistribution
    clearance = k * volume
    if (volume > 500) {
      warnings.push(
        `A volume of distribution of ${volume} L is far larger than any body. That is not an error — it is what the number means: the volume the drug would have to occupy to reach the measured plasma concentration, and a drug that concentrates in fat or tissue gives a figure in the hundreds or thousands of litres.`
      )
    }
  }

  let steadyState: PharmacokineticsReport['steadyState'] = null
  if (input.dosingInterval !== undefined) {
    if (!Number.isFinite(input.dosingInterval) || input.dosingInterval <= 0) {
      return fail('invalid-argument', 'The dosing interval has to be a positive number of hours.')
    }
    const remaining = Math.exp(-k * input.dosingInterval)
    const accumulation = 1 / (1 - remaining)
    steadyState = {
      peakFactor: accumulation,
      troughFactor: accumulation * remaining,
      accumulationFactor: accumulation,
      interval: input.dosingInterval
    }
    if (accumulation > 2) {
      warnings.push(
        `Dosing every ${input.dosingInterval} h against a ${halfLife.toFixed(2)} h half-life accumulates by a factor of ${accumulation.toFixed(2)}. The steady-state level is that many times the level from one dose — dosing every half-life doubles it, every quarter half-life multiplies it by about five. This is where unintended toxicity comes from, and it is pure arithmetic.`
      )
    }
  }

  const trace: { hours: number; fraction: number }[] = []
  const span = Math.max(hoursToClear, (steadyState?.interval ?? 0) * 3)
  for (let i = 0; i <= 80; i += 1) {
    const hours = (span * i) / 80
    trace.push({ hours, fraction: Math.exp(-k * hours) })
  }

  return {
    halfLife,
    eliminationConstant: k,
    volumeOfDistribution: volume,
    clearance,
    practicallyCleared: { hours: hoursToClear, halfLives: halfLivesToClear, remainingFraction: threshold },
    timeToSteadyState: halfLife * 5,
    trace: Object.freeze(trace),
    steadyState,
    notClinical: NOT_CLINICAL,
    notes: Object.freeze([
      `Half-life ${halfLife.toFixed(4)} h, elimination constant ${k.toPrecision(5)} per hour.`,
      `Down to ${(threshold * 100).toFixed(1)}% remaining after ${hoursToClear.toFixed(2)} h, which is ${halfLivesToClear.toFixed(2)} half-lives. Nothing reaches zero under first-order elimination, so "cleared" always means a threshold somebody chose.`,
      `On repeated dosing a steady level takes about five half-lives — ${(halfLife * 5).toFixed(2)} h — whatever the dose or the interval. Changing the dose changes the level reached, not the time taken to reach it, and that is why a loading dose exists.`,
      clearance === null
        ? 'No volume of distribution was given, so no clearance. Clearance is the elimination constant times the volume.'
        : `Clearance ${clearance.toFixed(4)} L/h from a volume of ${(volume as number).toFixed(2)} L.`,
      steadyState === null
        ? 'No dosing interval was given, so no accumulation figures.'
        : `At steady state the peak is ${steadyState.peakFactor.toFixed(3)} times and the trough ${steadyState.troughFactor.toFixed(3)} times the concentration from a single dose.`,
      NOT_CLINICAL
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const PHYSIOLOGY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Nothing here is a clinical judgement, a diagnosis, or a dose. Every result that describes a person says so.',
  'Every equation is named with the population it was fitted to, and where several apply they are all reported with their spread, because a single unnamed number hides a disagreement of over a hundred kilocalories or several percent of surface area.',
  'Body mass index is reported with the statement that it is mass over height squared and cannot distinguish muscle from fat, and that its bands come from mid-twentieth-century European and North American populations.',
  'The adult index bands are refused for anyone under 20, where percentile charts apply instead.',
  'Basal metabolic rate and daily need are kept separate, and the activity factors are stated as the coarsest part of the calculation.',
  'Mean arterial pressure uses the one-third approximation and says where it breaks down.',
  'Cardiac index rather than raw output is named as the figure that compares between people.',
  'Alveolar ventilation is computed separately from minute ventilation, because dead space is paid per breath and shallow fast breathing delivers far less at the same total.',
  'A dead space at or above the tidal volume is refused as a calculation rather than reported as a negative alveolar ventilation.',
  'Kidney function uses the 2021 CKD-EPI equation, which removed the race coefficient the 2009 version carried; both estimates are reported with the statement that they overestimate function in anyone with little muscle.',
  'Pharmacokinetics assumes first-order elimination and names alcohol and phenytoin as substances for which every figure would be wrong.',
  'Nothing reaches zero under first-order elimination, so "cleared" always names the threshold it used.'
])
