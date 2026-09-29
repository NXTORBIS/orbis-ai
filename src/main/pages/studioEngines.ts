/**
 * The studio a Page can reach: study schedules, music and colour, media arithmetic, and project maths.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## No clock
 *
 * Nothing here reads the system time. A review schedule returns an interval in days and the Page decides what date
 * that lands on; an estimate returns a duration and not a deadline. That keeps every result reproducible and lets a
 * Page ask about a schedule other than today's.
 *
 * ## The operations that refuse rather than default
 *
 * `study.review` refuses a grade outside 0 to 5 and explains where the pass boundary is, because almost all of a
 * scheduler's behaviour turns on it. `music.frequency` refuses just or Pythagorean tuning without a tonic, since in
 * those tunings the same note has a different frequency in a different key. `media.timecode` refuses a drop-frame
 * timecode whose frame number is one of the skipped ones. `plan.flow` refuses full utilisation, and the refusal is
 * the answer — the queue grows without bound there. `plan.estimate` refuses three figures out of order.
 */

import {
  CURVE_FACTS,
  FORGETTING_CURVES,
  LEARNING_ASSUMPTIONS,
  SCHEDULERS,
  SCHEDULER_FACTS,
  isLearningError,
  mastery,
  retention,
  reviewWorkload,
  scheduleReview,
  studyPlan,
  type ForgettingCurve,
  type ReviewState,
  type Scheduler
} from '../../shared/compute/learning.ts'
import {
  CHORD_PATTERNS,
  CHORD_QUALITIES,
  CREATIVE_ASSUMPTIONS,
  HARMONIES,
  SCALE_NAMES,
  SCALE_PATTERNS,
  SCALE_RATIOS,
  TUNINGS,
  TUNING_FACTS,
  chord,
  contrast,
  frequencyOf,
  isCreativeError,
  modularScale,
  palette,
  parseNote,
  scale,
  tempo,
  type ChordQuality,
  type Harmony,
  type ScaleName,
} from '../../shared/compute/creative.ts'
import {
  FRAME_RATES,
  LOUDNESS_TARGETS,
  MEDIA_ASSUMPTIONS,
  aspectRatio,
  fileSize,
  frameRateById,
  isMediaError,
  loudness,
  printSize,
  timecode
} from '../../shared/compute/media.ts'
import {
  PRIORITY_FACTS,
  PRIORITY_METHODS,
  PRODUCTIVITY_ASSUMPTIONS,
  aggregateBuffer,
  criticalPath,
  estimate,
  flow,
  isProductivityError,
  prioritise,
  type PriorityMethod,
  type Task
} from '../../shared/compute/productivity.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can schedule a review can also work out a delay time, and splitting
 * them into four permissions would ask the user four questions about the same thing — arithmetic that reaches
 * nothing outside the Page.
 */
export const STUDIO_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- revision and study scheduling. Named `revise` rather than `study`, because `study` is already the
  // parameter-study family and the generation catalogue excludes that whole prefix — these would never be offered.
  'revise.review': 'computation.studio',
  'revise.schedulers': 'computation.studio',
  'revise.retention': 'computation.studio',
  'revise.curves': 'computation.studio',
  'revise.mastery': 'computation.studio',
  'revise.plan': 'computation.studio',
  'revise.workload': 'computation.studio',

  // ---- music
  'music.note': 'computation.studio',
  'music.frequency': 'computation.studio',
  'music.tunings': 'computation.studio',
  'music.scale': 'computation.studio',
  'music.scales': 'computation.studio',
  'music.chord': 'computation.studio',
  'music.chords': 'computation.studio',
  'music.tempo': 'computation.studio',

  // ---- colour and layout
  'colour.contrast': 'computation.studio',
  'colour.palette': 'computation.studio',
  'colour.harmonies': 'computation.studio',
  'layout.scale': 'computation.studio',
  'layout.ratios': 'computation.studio',

  // ---- media
  'media.frame-rates': 'computation.studio',
  'media.timecode': 'computation.studio',
  'media.file-size': 'computation.studio',
  'media.aspect-ratio': 'computation.studio',
  'media.loudness': 'computation.studio',
  'media.loudness-targets': 'computation.studio',
  'media.print-size': 'computation.studio',

  // ---- planning
  'plan.estimate': 'computation.studio',
  'plan.buffer': 'computation.studio',
  'plan.critical-path': 'computation.studio',
  'plan.prioritise': 'computation.studio',
  'plan.priority-methods': 'computation.studio',
  'plan.flow': 'computation.studio',

  // ---- provenance
  'studio.assumptions': 'computation.studio'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const STUDIO_LIMITS = Object.freeze({
  topics: 500,
  cards: 20_000,
  days: 3650,
  samples: 2000,
  tracks: 64,
  tasks: 2000,
  items: 5000,
  answers: 10_000,
  levels: 20
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function objectAt(read: Reader, key: string): Reader {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object.`)
  }
  return new Reader(raw as Record<string, unknown>)
}

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/**
 * Reads a group of arguments where the engine requires some of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is the point:
 * Little's law needs any two of three quantities, and a review state has a different shape for each scheduler. An
 * operation offered with only the arguments a static reader can see would pass the argument check and then be
 * refused by the engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

function stateFrom(read: Reader): ReviewState | undefined {
  if (!read.has('state')) return undefined
  const entry = objectAt(read, 'state')
  return {
    interval: entry.optionalNumber('interval', 0),
    ease: entry.has('ease') ? entry.number('ease') : undefined,
    stability: entry.has('stability') ? entry.number('stability') : undefined,
    difficulty: entry.has('difficulty') ? entry.number('difficulty') : undefined,
    repetitions: entry.has('repetitions') ? Math.round(entry.number('repetitions')) : undefined,
    box: entry.has('box') ? Math.round(entry.number('box')) : undefined,
    lapses: entry.has('lapses') ? Math.round(entry.number('lapses')) : undefined
  }
}

/** A `{name: number}` map read safely, for the criteria and weights a priority method takes. */
function numberMap(read: Reader, key: string, max: number): Record<string, number> {
  const raw = read.raw(key)
  if (raw === undefined) return Object.create(null) as Record<string, number>
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a set of named numbers.`)
  }
  const out: Record<string, number> = Object.create(null)
  let count = 0
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= max) throw new BadInput(`"${key}" has more than the ${max} entries allowed.`)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === '__proto__' || name === 'constructor' || name === 'prototype') {
      throw new BadInput(`"${name}" is not a usable criterion name.`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadInput(`"${name}" has to be a finite number.`)
    out[name] = value
    count += 1
  }
  return out
}

/** Cut a long trace down to what a chart can use, keeping both ends. */
function thin<T>(samples: readonly T[], wanted: number): readonly T[] {
  if (samples.length <= wanted) return samples
  const step = (samples.length - 1) / (wanted - 1)
  const out: T[] = []
  for (let i = 0; i < wanted; i += 1) out.push(samples[Math.round(i * step)])
  return out
}

// ---------------------------------------------------------------- dispatch

export function runStudioOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- revision
    case 'revise.review':
      // Returns an interval in days, never a date: nothing here reads the clock, so the Page decides what day that
      // lands on and the answer is the same every run.
      return settle(
        scheduleReview({
          scheduler: choice<Scheduler>(read, 'scheduler', SCHEDULERS, 'sm2'),
          state: stateFrom(read),
          grade: read.number('grade'),
          elapsedDays: read.has('elapsedDays') ? read.number('elapsedDays') : undefined,
          targetRetention: read.optionalNumber('targetRetention', 0.9),
          maximumInterval: read.optionalNumber('maximumInterval', 36500)
        }),
        isLearningError
      )

    case 'revise.schedulers':
      return { ok: true, schedulers: SCHEDULERS, facts: SCHEDULER_FACTS }

    case 'revise.retention': {
      const built = retention({
        curve: read.choice('curve', FORGETTING_CURVES, 'power-law') as ForgettingCurve,
        elapsedDays: read.number('elapsedDays'),
        stability: read.number('stability'),
        threshold: read.optionalNumber('threshold', 0.9),
        duration: read.has('duration') ? read.number('duration') : undefined,
        samples: Math.round(read.optionalNumber('samples', 120))
      })
      if (isLearningError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 400)), STUDIO_LIMITS.samples))
      return { ok: true, ...built, samples: thin(built.samples, wanted) }
    }

    case 'revise.curves':
      return { ok: true, curves: FORGETTING_CURVES, facts: CURVE_FACTS }

    case 'revise.mastery': {
      // A count, or the answers in order. Only the sequence can give a trend, and neither alone is required.
      const counts = optionalGroup(read, ['attempts', 'correct', 'guessRate'])
      const sequence = read.has('sequence')
        ? (() => {
            const raw = read.raw('sequence')
            if (!Array.isArray(raw)) throw new BadInput('"sequence" has to be a list of true and false.')
            if (raw.length > STUDIO_LIMITS.answers) throw new BadInput(`"sequence" has more than the ${STUDIO_LIMITS.answers} answers allowed.`)
            return raw.map((one, i) => {
              if (typeof one !== 'boolean') throw new BadInput(`Answer ${i + 1} is not true or false.`)
              return one
            })
          })()
        : undefined
      return settle(
        mastery({
          attempts: counts.attempts === undefined ? undefined : Math.round(counts.attempts),
          correct: counts.correct === undefined ? undefined : Math.round(counts.correct),
          guessRate: counts.guessRate,
          sequence
        }),
        isLearningError
      )
    }

    case 'revise.plan': {
      const topics = read.list('topics', STUDIO_LIMITS.topics).map((one, i) => {
        const entry = new Reader(one)
        return {
          topic: entry.optionalText('topic', '', 300) || `topic ${i + 1}`,
          weight: entry.has('weight') ? entry.number('weight') : undefined,
          minimumMinutes: entry.has('minimumMinutes') ? entry.number('minimumMinutes') : undefined
        }
      })
      return settle(
        studyPlan({
          topics,
          minutesPerDay: read.number('minutesPerDay'),
          days: Math.round(read.number('days')),
          minimumBlock: read.optionalNumber('minimumBlock', 10)
        }),
        isLearningError
      )
    }

    case 'revise.workload': {
      const cards = read.list('cards', STUDIO_LIMITS.cards).map((one) => {
        const entry = new Reader(one)
        return {
          dueDay: entry.number('dueDay'),
          interval: entry.number('interval'),
          growth: entry.has('growth') ? entry.number('growth') : undefined
        }
      })
      const built = reviewWorkload({
        cards,
        days: Math.round(read.number('days')),
        secondsPerReview: read.optionalNumber('secondsPerReview', 10)
      })
      if (isLearningError(built)) return { ok: false, ...built }
      const wanted = Math.max(1, Math.min(Math.round(read.optionalNumber('trace', 400)), STUDIO_LIMITS.days))
      return { ok: true, ...built, days: thin(built.days, wanted) }
    }

    // ---------------------------------------------------------------- music
    case 'music.note':
      return settle(parseNote(read.text('note', 32)), isCreativeError)

    case 'music.frequency': {
      // A tonic is required for just and Pythagorean tuning and meaningless for equal temperament, so it is read
      // as a group rather than declared required.
      const tonic = read.has('tonic') ? read.text('tonic', 32) : undefined
      return settle(
        frequencyOf({
          note: read.text('note', 32),
          // Read straight off the reader so the catalogue can see it. The tonic it needs for just and Pythagorean
          // tuning stays invisible, so a Page asking for those without one gets the engine's own explanation.
          tuning: read.choice('tuning', TUNINGS, 'equal-temperament'),
          referenceA4: read.optionalNumber('referenceA4', 440),
          tonic
        }),
        isCreativeError
      )
    }

    case 'music.tunings':
      return { ok: true, tunings: TUNINGS, facts: TUNING_FACTS }

    case 'music.scale':
      return settle(scale({ tonic: read.text('tonic', 32), scale: read.choice('scale', SCALE_NAMES, 'major') as ScaleName }), isCreativeError)

    case 'music.scales':
      return { ok: true, scales: SCALE_NAMES, patterns: SCALE_PATTERNS }

    case 'music.chord':
      return settle(
        chord({ root: read.text('root', 32), quality: read.choice('quality', CHORD_QUALITIES, 'major') as ChordQuality }),
        isCreativeError
      )

    case 'music.chords':
      return { ok: true, qualities: CHORD_QUALITIES, patterns: CHORD_PATTERNS }

    case 'music.tempo':
      return settle(
        tempo({
          beatsPerMinute: read.number('beatsPerMinute'),
          beatsPerBar: Math.round(read.optionalNumber('beatsPerBar', 4)),
          beatUnit: Math.round(read.optionalNumber('beatUnit', 4))
        }),
        isCreativeError
      )

    // ---------------------------------------------------------------- colour and layout
    case 'colour.contrast':
      return settle(
        contrast({
          foreground: read.text('foreground', 64),
          background: read.text('background', 64),
          fontSize: read.optionalNumber('fontSize', 16),
          bold: read.boolean('bold', false)
        }),
        isCreativeError
      )

    case 'colour.palette':
      return settle(
        palette({
          base: read.text('base', 64),
          harmony: read.choice('harmony', HARMONIES, 'complementary') as Harmony,
          steps: Math.round(read.optionalNumber('steps', 5))
        }),
        isCreativeError
      )

    case 'colour.harmonies':
      return { ok: true, harmonies: HARMONIES }

    case 'layout.scale': {
      // A named ratio and a numeric one are separate arguments rather than one that accepts either, so both are
      // visible to the generation catalogue. The number wins when both are given.
      const named = read.optionalText('ratio', 'minor-third', 64)
      const custom = read.optionalNumber('ratioValue', 0)
      return settle(
        modularScale({
          base: read.number('base'),
          ratio: custom > 0 ? custom : named,
          up: Math.round(read.optionalNumber('up', 5)),
          down: Math.round(read.optionalNumber('down', 2)),
          round: read.boolean('round', true)
        }),
        isCreativeError
      )
    }

    case 'layout.ratios':
      return { ok: true, ratios: SCALE_RATIOS }

    // ---------------------------------------------------------------- media
    case 'media.frame-rates':
      return { ok: true, frameRates: FRAME_RATES }

    case 'media.timecode': {
      // One of frames, timecode or seconds. Exactly one is needed and none alone is required.
      const numbers = optionalGroup(read, ['frames', 'seconds'])
      const rate = frameRateById(read.text('frameRate', 16))
      if (isMediaError(rate)) return { ok: false, ...rate }
      return settle(
        timecode({
          frameRate: rate.id,
          frames: numbers.frames,
          seconds: numbers.seconds,
          timecode: read.optionalText('timecode', '', 32) || undefined,
          dropFrame: read.has('dropFrame') ? read.boolean('dropFrame', rate.dropFrame) : undefined
        }),
        isMediaError
      )
    }

    case 'media.file-size': {
      const tracks = read.list('tracks', STUDIO_LIMITS.tracks).map((one, i) => {
        const entry = new Reader(one)
        return { label: entry.optionalText('label', '', 200) || `track ${i + 1}`, bitrate: entry.number('bitrate') }
      })
      const target = optionalGroup(read, ['targetBytes'])
      return settle(
        fileSize({
          tracks,
          durationSeconds: read.number('durationSeconds'),
          overhead: read.optionalNumber('overhead', 0.02),
          ...target
        }),
        isMediaError
      )
    }

    case 'media.aspect-ratio': {
      // A target shape is optional and needs both dimensions, so the pair is read as a group.
      const target = optionalGroup(read, ['targetWidth', 'targetHeight'])
      return settle(aspectRatio({ width: read.number('width'), height: read.number('height'), ...target }), isMediaError)
    }

    case 'media.loudness': {
      // A target in LUFS, or a named platform. Either works and neither alone is required.
      const target = optionalGroup(read, ['target', 'truePeak'])
      return settle(
        loudness({
          integratedLoudness: read.number('integratedLoudness'),
          platform: read.optionalText('platform', '', 32) || undefined,
          ...target
        }),
        isMediaError
      )
    }

    case 'media.loudness-targets':
      return { ok: true, targets: LOUDNESS_TARGETS }

    case 'media.print-size': {
      const requested = optionalGroup(read, ['requestedWidth', 'requestedHeight'])
      return settle(
        printSize({
          pixelWidth: read.number('pixelWidth'),
          pixelHeight: read.number('pixelHeight'),
          dpi: read.optionalNumber('dpi', 300),
          ...requested
        }),
        isMediaError
      )
    }

    // ---------------------------------------------------------------- planning
    case 'plan.estimate':
      return settle(
        estimate({
          optimistic: read.number('optimistic'),
          likely: read.number('likely'),
          pessimistic: read.number('pessimistic'),
          confidences: read.has('confidences') ? read.numbers('confidences', 32) : undefined
        }),
        isProductivityError
      )

    case 'plan.buffer': {
      const tasks = read.list('tasks', STUDIO_LIMITS.tasks).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 300) || `task ${i + 1}`,
          expected: entry.number('expected'),
          standardDeviation: entry.number('standardDeviation')
        }
      })
      return settle(aggregateBuffer({ tasks, confidence: read.optionalNumber('confidence', 0.85) }), isProductivityError)
    }

    case 'plan.critical-path': {
      const tasks: Task[] = read.list('tasks', STUDIO_LIMITS.tasks).map((one) => {
        const entry = new Reader(one)
        return {
          id: entry.text('id', 200),
          label: entry.optionalText('label', '', 300) || undefined,
          duration: entry.number('duration'),
          dependsOn: entry.has('dependsOn') ? entry.strings('dependsOn', STUDIO_LIMITS.tasks) : undefined
        }
      })
      return settle(criticalPath({ tasks }), isProductivityError)
    }

    case 'plan.prioritise': {
      const items = read.list('items', STUDIO_LIMITS.items).map((one) => {
        const entry = new Reader(one)
        return {
          id: entry.text('id', 200),
          label: entry.optionalText('label', '', 300) || undefined,
          criteria: numberMap(entry, 'criteria', 64)
        }
      })
      return settle(
        prioritise({
          method: choice<PriorityMethod>(read, 'method', PRIORITY_METHODS, 'weighted-score'),
          items,
          weights: read.has('weights') ? numberMap(read, 'weights', 64) : undefined
        }),
        isProductivityError
      )
    }

    case 'plan.priority-methods':
      return { ok: true, methods: PRIORITY_METHODS, facts: PRIORITY_FACTS }

    case 'plan.flow': {
      // Any two of throughput, work in progress and cycle time fix the third, so all three are read as a group.
      const quantities = optionalGroup(read, ['throughput', 'workInProgress', 'cycleTime', 'utilisation'])
      return settle(
        flow({ ...quantities, wipLimits: read.has('wipLimits') ? read.numbers('wipLimits', 64) : undefined }),
        isProductivityError
      )
    }

    // ---------------------------------------------------------------- provenance
    case 'studio.assumptions':
      return {
        ok: true,
        learning: LEARNING_ASSUMPTIONS,
        creative: CREATIVE_ASSUMPTIONS,
        media: MEDIA_ASSUMPTIONS,
        planning: PRODUCTIVITY_ASSUMPTIONS
      }

    default:
      throw new BadInput(`"${operation}" is not a studio operation.`)
  }
}
