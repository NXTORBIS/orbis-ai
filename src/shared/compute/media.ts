/**
 * Media: file sizes, timecode, frame rates, aspect ratios, loudness and print dimensions.
 *
 * The shared media engine for Orbis Pages. Bitrates and durations are related exactly, timecode handles drop-frame
 * rather than pretending 29.97 is 30, and every result that depends on a convention says which one.
 *
 * ## Why drop-frame timecode exists and is handled
 *
 * NTSC video runs at 30000/1001 frames per second, not 30. Counting frames as though it were 30 makes the timecode
 * drift 3.6 seconds ahead of real time every hour. Drop-frame timecode skips frame *numbers* — never frames — to
 * keep the count aligned. A broadcast delivery that gets this wrong is out by seconds over a programme, and a
 * calculation that silently assumes 30 fps is the way it goes wrong.
 *
 * ## Why file size and bitrate are exact and quality is not
 *
 * Size is bitrate times duration, and that is arithmetic. Whether a given bitrate looks acceptable depends on the
 * codec, the content and the viewer, and no formula gives it. This engine computes the first and refuses to pretend
 * about the second.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * bit          vs  byte             -- a factor of eight, and both are used for bitrates and sizes
 * MB           vs  MiB              -- 10^6 against 2^20, a 4.9% difference that compounds
 * frame rate   vs  timecode rate    -- 29.97 against 30, and drop-frame between them
 * peak         vs  loudness         -- the tallest sample against how loud it sounds
 * resolution   vs  print size       -- pixels against inches, and DPI is the only link
 * aspect ratio vs  pixel aspect     -- the shape of the picture against the shape of a pixel
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface MediaError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'no-solution' | 'too-many'
  message: string
}

export const isMediaError = (value: unknown): value is MediaError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: MediaError['error'], message: string): MediaError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const MEDIA_LIMITS = Object.freeze({ tracks: 64, frames: 100_000_000, samples: 2000 })

// ---------------------------------------------------------------- frame rates

export interface FrameRate {
  id: string
  label: string
  /** The exact rate as a fraction, because 29.97 is not exact. */
  numerator: number
  denominator: number
  exact: number
  dropFrame: boolean
  usedFor: string
}

export const FRAME_RATES: readonly FrameRate[] = Object.freeze([
  { id: '23.976', label: '23.976 (24 slowed for NTSC)', numerator: 24000, denominator: 1001, exact: 24000 / 1001, dropFrame: false, usedFor: 'Film transferred for NTSC territories, and most streaming.' },
  { id: '24', label: '24', numerator: 24, denominator: 1, exact: 24, dropFrame: false, usedFor: 'Cinema, and the rate film has run at since sound arrived.' },
  { id: '25', label: '25', numerator: 25, denominator: 1, exact: 25, dropFrame: false, usedFor: 'PAL territories. Exactly half the 50 Hz mains frequency, which is why.' },
  { id: '29.97', label: '29.97 (NTSC)', numerator: 30000, denominator: 1001, exact: 30000 / 1001, dropFrame: true, usedFor: 'NTSC broadcast. The 0.1% slowdown was to fit the colour subcarrier in 1953, and the world has lived with it since.' },
  { id: '30', label: '30', numerator: 30, denominator: 1, exact: 30, dropFrame: false, usedFor: 'Some digital capture. Not NTSC, which is 29.97 — assuming they are the same is the classic timecode error.' },
  { id: '50', label: '50', numerator: 50, denominator: 1, exact: 50, dropFrame: false, usedFor: 'PAL high frame rate, and sport.' },
  { id: '59.94', label: '59.94', numerator: 60000, denominator: 1001, exact: 60000 / 1001, dropFrame: true, usedFor: 'NTSC high frame rate.' },
  { id: '60', label: '60', numerator: 60, denominator: 1, exact: 60, dropFrame: false, usedFor: 'Games and digital capture.' }
])

export function frameRateById(id: string): FrameRate | MediaError {
  const found = FRAME_RATES.find((one) => one.id === id)
  return found ?? fail('invalid-argument', `"${id}" is not a frame rate this knows: ${FRAME_RATES.map((one) => one.id).join(', ')}.`)
}

export interface TimecodeReport {
  timecode: string
  frames: number
  /** Seconds of real time, which is not the timecode read as hours and minutes when the rate is fractional. */
  seconds: number
  frameRate: string
  dropFrame: boolean
  /** How far the timecode is from real time if it were read as though the rate were whole. */
  driftSeconds: number
  hours: number
  minutes: number
  secondsField: number
  framesField: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Convert between a frame count and a timecode, with drop-frame handled properly.
 *
 * Drop-frame skips frame *numbers*, not frames: at 29.97 the numbers :00 and :01 are omitted at the start of every
 * minute except every tenth. That keeps an hour of timecode within a couple of frames of an hour of real time. The
 * drift figure shows what would happen without it — 3.6 seconds an hour, which over a programme is the difference
 * between hitting a commercial break and missing it.
 */
export function timecode(input: {
  frameRate: string
  /** One of these. */
  frames?: number
  timecode?: string
  seconds?: number
  /** Override the rate's own default, for a non-drop count at a fractional rate. */
  dropFrame?: boolean
}): TimecodeReport | MediaError {
  const rate = frameRateById(input.frameRate)
  if (isMediaError(rate)) return rate
  const dropFrame = input.dropFrame ?? rate.dropFrame
  if (dropFrame && !rate.dropFrame) {
    return fail(
      'invalid-argument',
      `Drop-frame only applies to fractional rates like 29.97 and 59.94. At ${rate.label} the timecode already matches real time, so there is nothing to drop.`
    )
  }
  // The nominal rate the timecode is counted in: 30 for 29.97, 60 for 59.94.
  const nominal = Math.round(rate.exact)

  const given = ['frames', 'timecode', 'seconds'].filter((one) => input[one as 'frames'] !== undefined)
  if (given.length === 0) return fail('invalid-argument', 'Give a frame count, a timecode or a number of seconds.')
  if (given.length > 1) return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one fixes the others, so pick one.`)

  const dropPerMinute = dropFrame ? Math.round(nominal / 15) : 0

  const framesToTimecode = (total: number): { hours: number; minutes: number; seconds: number; frames: number } => {
    let working = total
    if (dropFrame) {
      const framesPerTenMinutes = nominal * 60 * 10 - 9 * dropPerMinute
      const tens = Math.floor(working / framesPerTenMinutes)
      let remainder = working % framesPerTenMinutes
      // The first minute of each ten drops nothing.
      if (remainder >= dropPerMinute) {
        const framesPerMinute = nominal * 60 - dropPerMinute
        const minutes = Math.floor((remainder - dropPerMinute) / framesPerMinute)
        remainder = remainder + dropPerMinute * minutes
      }
      working = tens * nominal * 60 * 10 + remainder
    }
    const framesField = working % nominal
    const totalSeconds = Math.floor(working / nominal)
    return {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      frames: framesField
    }
  }

  const timecodeToFrames = (h: number, m: number, s: number, f: number): number => {
    const plain = ((h * 60 + m) * 60 + s) * nominal + f
    if (!dropFrame) return plain
    const totalMinutes = h * 60 + m
    return plain - dropPerMinute * (totalMinutes - Math.floor(totalMinutes / 10))
  }

  let frames: number
  if (input.frames !== undefined) {
    frames = Math.round(input.frames)
    if (!finite(frames) || frames < 0) return fail('invalid-argument', 'The frame count cannot be negative.')
    if (frames > MEDIA_LIMITS.frames) return fail('too-many', `That is more than the ${MEDIA_LIMITS.frames} frames this handles.`)
  } else if (input.seconds !== undefined) {
    if (!finite(input.seconds) || input.seconds < 0) return fail('invalid-argument', 'The duration cannot be negative.')
    frames = Math.round(input.seconds * rate.exact)
  } else {
    const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)([:;])(\d{1,3})$/.exec((input.timecode as string).trim())
    if (match === null) {
      return fail('invalid-argument', 'A timecode looks like 01:23:45:12, or 01:23:45;12 with a semicolon for drop-frame.')
    }
    const [, h, m, s, separator, f] = match
    const framesField = Number(f)
    if (framesField >= nominal) {
      return fail('out-of-range', `The frame field is ${framesField} and this rate counts 0 to ${nominal - 1}.`)
    }
    if (dropFrame && separator === ':') {
      // Not an error: the semicolon convention is widely used and widely ignored.
    }
    const minutes = Number(m)
    if (dropFrame && Number(s) === 0 && minutes % 10 !== 0 && framesField < dropPerMinute) {
      return fail(
        'no-solution',
        `${input.timecode} is not a valid drop-frame timecode: the frame numbers 0 to ${dropPerMinute - 1} are skipped at the start of every minute except every tenth. The frames themselves are all there; only the numbers are missing.`
      )
    }
    frames = timecodeToFrames(Number(h), minutes, Number(s), framesField)
  }

  const parts = framesToTimecode(frames)
  const seconds = frames / rate.exact
  // What the timecode would read as real time if the rate were the whole number it looks like.
  const nominalSeconds = frames / nominal
  const drift = nominalSeconds - seconds

  const warnings: string[] = []
  if (!dropFrame && rate.dropFrame) {
    warnings.push(
      `This is non-drop timecode at ${rate.label}. It drifts ${Math.abs(drift).toFixed(3)} s behind real time over this duration — about 3.6 s an hour. That is legitimate for some workflows and wrong for broadcast delivery.`
    )
  }
  if (rate.id === '30' || rate.id === '60') {
    warnings.push(
      `${rate.label} is a whole frame rate, not NTSC. If this material came from a broadcast source it is probably ${rate.id === '30' ? '29.97' : '59.94'}, and treating the two as the same is the classic timecode error.`
    )
  }

  return {
    timecode: `${String(parts.hours).padStart(2, '0')}:${String(parts.minutes).padStart(2, '0')}:${String(parts.seconds).padStart(2, '0')}${dropFrame ? ';' : ':'}${String(parts.frames).padStart(2, '0')}`,
    frames,
    seconds,
    frameRate: rate.id,
    dropFrame,
    driftSeconds: drift,
    hours: parts.hours,
    minutes: parts.minutes,
    secondsField: parts.seconds,
    framesField: parts.frames,
    notes: Object.freeze([
      `${frames} frames at ${rate.label} is ${seconds.toFixed(3)} s of real time.`,
      `${rate.label}: ${rate.numerator}/${rate.denominator} frames per second exactly. ${rate.usedFor}`,
      dropFrame
        ? `Drop-frame: the frame numbers 0 to ${dropPerMinute - 1} are skipped at the start of every minute except every tenth. No frames are dropped — only their numbers — which keeps an hour of timecode within a couple of frames of an hour of clock time.`
        : 'Non-drop: every frame number is used, so the timecode counts frames honestly and drifts from the clock at fractional rates.',
      'The semicolon in the last separator is the usual sign of drop-frame. It is widely used and widely ignored, so it cannot be relied on.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- file size

export interface SizeReport {
  /** Bytes. */
  bytes: number
  /** Decimal and binary, because both are in use and they differ. */
  decimal: { value: number; unit: string; text: string }
  binary: { value: number; unit: string; text: string }
  /** Total bitrate in bits per second. */
  bitrate: number
  durationSeconds: number
  /** Each track's contribution. */
  tracks: readonly { label: string; bitrate: number; bytes: number; share: number }[]
  /** What would fit in a given size, when one was asked about. */
  fitsInMinutes: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * File size from bitrate and duration, in both decimal and binary units.
 *
 * Both, because both are in use and they differ by 4.9% — which is why a drive sold as 500 GB shows as 465 GiB, and
 * why a delivery spec in "MB" is ambiguous until somebody says which. Reporting one would be picking a side of a
 * real disagreement.
 */
export function fileSize(input: {
  /** Each track: video, audio, subtitles. Bitrate in bits per second. */
  tracks: readonly { label?: string; bitrate: number }[]
  durationSeconds: number
  /** Bytes of container overhead, as a fraction of the payload. */
  overhead?: number
  /** Bytes, to work out how much would fit. */
  targetBytes?: number
}): SizeReport | MediaError {
  const { tracks, durationSeconds } = input
  if (tracks.length === 0) return fail('invalid-argument', 'There are no tracks.')
  if (tracks.length > MEDIA_LIMITS.tracks) return fail('too-many', `That is more than the ${MEDIA_LIMITS.tracks} tracks this handles.`)
  if (!finite(durationSeconds) || durationSeconds < 0) return fail('invalid-argument', 'The duration cannot be negative.')

  const overhead = input.overhead ?? 0.02
  if (!finite(overhead) || overhead < 0 || overhead > 1) return fail('out-of-range', 'The overhead is a fraction from 0 to 1.')

  let totalBitrate = 0
  const resolved: SizeReport['tracks'][number][] = []
  for (const [i, one] of tracks.entries()) {
    if (!finite(one.bitrate) || one.bitrate < 0) return fail('invalid-argument', `Track ${i + 1} has a bitrate that is not zero or more.`)
    totalBitrate += one.bitrate
  }
  if (totalBitrate === 0) return fail('invalid-argument', 'Every track has a bitrate of zero, so the file would be empty.')

  const payloadBytes = (totalBitrate * durationSeconds) / 8
  const bytes = payloadBytes * (1 + overhead)
  for (const [i, one] of tracks.entries()) {
    const trackBytes = (one.bitrate * durationSeconds) / 8
    resolved.push({
      label: one.label ?? `track ${i + 1}`,
      bitrate: one.bitrate,
      bytes: trackBytes,
      share: payloadBytes === 0 ? 0 : trackBytes / payloadBytes
    })
  }

  const decimalUnits = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']
  const binaryUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const scale = (value: number, base: number, units: readonly string[]): { value: number; unit: string; text: string } => {
    let index = 0
    let working = value
    while (working >= base && index < units.length - 1) {
      working /= base
      index += 1
    }
    return { value: working, unit: units[index], text: `${working.toFixed(working >= 100 ? 0 : 2)} ${units[index]}` }
  }

  const warnings: string[] = []
  if (input.targetBytes !== undefined && (!finite(input.targetBytes) || input.targetBytes <= 0)) {
    return fail('invalid-argument', 'The target size has to be greater than zero bytes.')
  }
  const fitsInMinutes =
    input.targetBytes === undefined ? null : (input.targetBytes * 8) / (totalBitrate * (1 + overhead)) / 60

  const biggest = resolved.reduce((best, one) => (one.bytes > best.bytes ? one : best))
  if (biggest.share > 0.9 && resolved.length > 1) {
    warnings.push(
      `"${biggest.label}" is ${(biggest.share * 100).toFixed(1)}% of the file. Reducing anything else will not noticeably change the size.`
    )
  }

  return {
    bytes,
    decimal: scale(bytes, 1000, decimalUnits),
    binary: scale(bytes, 1024, binaryUnits),
    bitrate: totalBitrate,
    durationSeconds,
    tracks: Object.freeze(resolved),
    fitsInMinutes,
    notes: Object.freeze([
      `${scale(bytes, 1000, decimalUnits).text} in decimal units, ${scale(bytes, 1024, binaryUnits).text} in binary. Both are given because both are in use and they differ by 4.9% per step.`,
      `${totalBitrate} bits per second over ${durationSeconds} s, plus ${(overhead * 100).toFixed(1)}% container overhead.`,
      fitsInMinutes === null
        ? 'Give a target size to find out how much would fit in it.'
        : `About ${fitsInMinutes.toFixed(1)} minutes would fit in the target size at this bitrate.`,
      'Size is exact arithmetic. Whether this bitrate looks acceptable is not, and depends on the codec, the content and the viewer — no formula here gives it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- aspect ratios

export interface AspectReport {
  width: number
  height: number
  /** The ratio as a decimal. */
  ratio: number
  /** The ratio in lowest whole-number terms. */
  simplified: { width: number; height: number; text: string }
  /** The named ratio, when it matches a common one closely. */
  named: string | null
  /** What happens fitting this into a target shape. */
  inside: {
    letterbox: { width: number; height: number; barHeight: number; barWidth: number; kind: 'letterbox' | 'pillarbox' | 'exact' }
    crop: { width: number; height: number; lostFraction: number }
    stretch: { distortion: number }
  } | null
  megapixels: number
  notes: readonly string[]
  warnings: readonly string[]
}

const NAMED_RATIOS: readonly { ratio: number; name: string }[] = Object.freeze([
  { ratio: 1, name: '1:1 (square)' },
  { ratio: 4 / 5, name: '4:5 (portrait, social)' },
  { ratio: 9 / 16, name: '9:16 (vertical video)' },
  { ratio: 5 / 4, name: '5:4' },
  { ratio: 4 / 3, name: '4:3 (classic television and early cinema)' },
  { ratio: 3 / 2, name: '3:2 (35 mm still film)' },
  { ratio: 16 / 10, name: '16:10' },
  { ratio: 16 / 9, name: '16:9 (HD and most screens)' },
  { ratio: 1.85, name: '1.85:1 (widescreen cinema)' },
  { ratio: 2 / 1, name: '2:1' },
  { ratio: 2.35, name: '2.35:1 (anamorphic scope)' },
  { ratio: 2.39, name: '2.39:1 (modern scope)' }
])

/**
 * An aspect ratio, and what happens when a picture of one shape goes into another.
 *
 * All three ways of fitting are reported with their cost: letterboxing adds bars, cropping loses picture, stretching
 * distorts. Every one of those is a decision with a consequence, and showing only the one somebody chose hides what
 * it cost.
 */
export function aspectRatio(input: {
  width: number
  height: number
  /** A target shape to fit into. */
  targetWidth?: number
  targetHeight?: number
}): AspectReport | MediaError {
  const { width, height } = input
  for (const [name, value] of Object.entries({ width, height })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  const ratio = width / height
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(Math.round(width), Math.round(height))
  const simplified = {
    width: Math.round(width) / divisor,
    height: Math.round(height) / divisor,
    text: `${Math.round(width) / divisor}:${Math.round(height) / divisor}`
  }

  const match = NAMED_RATIOS.find((one) => Math.abs(one.ratio - ratio) < 0.005)
  const warnings: string[] = []

  let inside: AspectReport['inside'] = null
  if (input.targetWidth !== undefined && input.targetHeight !== undefined) {
    const { targetWidth, targetHeight } = input
    if (!finite(targetWidth) || !finite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
      return fail('invalid-argument', 'The target dimensions have to be greater than zero.')
    }
    const targetRatio = targetWidth / targetHeight
    const fitScale = Math.min(targetWidth / width, targetHeight / height)
    const fitWidth = width * fitScale
    const fitHeight = height * fitScale
    const cropScale = Math.max(targetWidth / width, targetHeight / height)
    const cropWidth = width * cropScale
    const cropHeight = height * cropScale
    const lost = 1 - (targetWidth * targetHeight) / (cropWidth * cropHeight)

    inside = {
      letterbox: {
        width: fitWidth,
        height: fitHeight,
        barHeight: (targetHeight - fitHeight) / 2,
        barWidth: (targetWidth - fitWidth) / 2,
        kind: Math.abs(ratio - targetRatio) < 1e-6 ? 'exact' : ratio > targetRatio ? 'letterbox' : 'pillarbox'
      },
      crop: { width: cropWidth, height: cropHeight, lostFraction: lost },
      stretch: { distortion: Math.abs(ratio / targetRatio - 1) }
    }

    if (lost > 0.2) {
      warnings.push(
        `Cropping to fit loses ${(lost * 100).toFixed(1)}% of the picture. At that much, a fixed crop will cut something important — this is where a pan-and-scan decision is needed rather than an automatic one.`
      )
    }
    if (Math.abs(ratio / targetRatio - 1) > 0.05) {
      warnings.push(
        `Stretching would distort by ${(Math.abs(ratio / targetRatio - 1) * 100).toFixed(1)}%. Past about 5% faces look visibly wrong, which is why letterboxing won the argument.`
      )
    }
  }

  return {
    width,
    height,
    ratio,
    simplified,
    named: match?.name ?? null,
    inside,
    megapixels: (width * height) / 1e6,
    notes: Object.freeze([
      `${width} by ${height} is ${ratio.toFixed(4)}:1, or ${simplified.text}${match === undefined ? '' : ` — ${match.name}`}.`,
      `${((width * height) / 1e6).toFixed(2)} megapixels.`,
      inside === null
        ? 'Give a target width and height to see what fitting into another shape costs.'
        : 'All three ways of fitting are shown with their cost: bars, lost picture, or distortion. Each is a decision and each costs something.',
      'This assumes square pixels. Some older video formats have non-square pixels, where the picture shape and the pixel grid are different ratios and the two have to be tracked separately.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- loudness

export interface LoudnessReport {
  /** The integrated loudness given. */
  loudness: number
  /** The target. */
  target: number
  /** dB of gain to apply. Negative means turn it down. */
  gainDb: number
  /** The linear factor that gain corresponds to. */
  gainFactor: number
  /** True peak after the gain, when one was given. */
  resultingTruePeak: number | null
  /** Whether that would clip or breach the ceiling. */
  wouldClip: boolean
  /** The platform's own target and ceiling, when a platform was named. */
  platform: { name: string; target: number; ceiling: number; behaviour: string } | null
  notes: readonly string[]
  warnings: readonly string[]
}

export const LOUDNESS_TARGETS: readonly { id: string; name: string; target: number; ceiling: number; behaviour: string }[] =
  Object.freeze([
    { id: 'ebu-r128', name: 'EBU R128 (European broadcast)', target: -23, ceiling: -1, behaviour: 'A hard requirement for broadcast delivery. Material outside it is rejected.' },
    { id: 'atsc-a85', name: 'ATSC A/85 (US broadcast)', target: -24, ceiling: -2, behaviour: 'The US broadcast equivalent, one LU quieter.' },
    { id: 'spotify', name: 'Spotify', target: -14, ceiling: -1, behaviour: 'Normalises on playback. Louder masters are turned down, so mastering hot gains nothing and costs dynamic range.' },
    { id: 'apple-music', name: 'Apple Music', target: -16, ceiling: -1, behaviour: 'Sound Check normalises on playback, and can be turned off by the listener.' },
    { id: 'youtube', name: 'YouTube', target: -14, ceiling: -1, behaviour: 'Turns loud material down and does not turn quiet material up, so a quiet master stays quiet.' },
    { id: 'podcast', name: 'Podcast (common practice)', target: -16, ceiling: -1, behaviour: 'A convention rather than a standard. Mono podcasts are often targeted at -19.' }
  ])

/**
 * The gain needed to hit a loudness target, and whether that gain would clip.
 *
 * The clipping check is the part that matters. Turning a quiet master up to hit -14 LUFS raises the peaks by the same
 * amount, and if it was already peaking near zero the result clips — which is why loudness normalisation and peak
 * limiting have to be considered together rather than one after the other.
 *
 * Loudness is not peak level. A heavily limited track can be much louder than a dynamic one with identical peaks,
 * which is the whole reason LUFS exists.
 */
export function loudness(input: {
  /** LUFS, integrated. */
  integratedLoudness: number
  /** LUFS. */
  target?: number
  /** A named platform instead of a number. */
  platform?: string
  /** dBTP, for the clipping check. */
  truePeak?: number
}): LoudnessReport | MediaError {
  const { integratedLoudness } = input
  if (!finite(integratedLoudness)) return fail('not-finite', 'The integrated loudness has to be a finite number.')
  if (integratedLoudness > 0) {
    return fail('out-of-range', 'Integrated loudness in LUFS is negative — it is measured against full scale, so 0 is the maximum possible.')
  }

  let target: number
  let platform: LoudnessReport['platform'] = null
  if (input.platform !== undefined) {
    const found = LOUDNESS_TARGETS.find((one) => one.id === input.platform)
    if (!found) {
      return fail('invalid-argument', `"${input.platform}" is not a platform this knows: ${LOUDNESS_TARGETS.map((one) => one.id).join(', ')}.`)
    }
    platform = { name: found.name, target: found.target, ceiling: found.ceiling, behaviour: found.behaviour }
    target = input.target ?? found.target
  } else {
    if (input.target === undefined) {
      return fail('invalid-argument', `Give a target in LUFS, or a platform: ${LOUDNESS_TARGETS.map((one) => one.id).join(', ')}.`)
    }
    target = input.target
  }
  if (!finite(target) || target > 0) return fail('out-of-range', 'The target in LUFS is negative.')

  const gainDb = target - integratedLoudness
  const gainFactor = Math.pow(10, gainDb / 20)

  let resultingTruePeak: number | null = null
  let wouldClip = false
  const warnings: string[] = []
  if (input.truePeak !== undefined) {
    if (!finite(input.truePeak)) return fail('not-finite', 'The true peak has to be a finite number.')
    resultingTruePeak = input.truePeak + gainDb
    const ceiling = platform?.ceiling ?? 0
    wouldClip = resultingTruePeak > ceiling
    if (wouldClip) {
      warnings.push(
        `Applying ${gainDb.toFixed(2)} dB would take the true peak to ${resultingTruePeak.toFixed(2)} dBTP, past the ${ceiling} dBTP ceiling. Loudness and peak have to be solved together — limiting first and normalising after is how material ends up clipped.`
      )
    }
  } else {
    warnings.push('No true peak was given, so there is no clipping check. Raising loudness raises the peaks by exactly the same amount, and that is where quiet masters get damaged.')
  }

  if (platform !== null && gainDb < -3) {
    warnings.push(
      `${platform.name} will turn this down by about ${Math.abs(gainDb).toFixed(1)} dB on playback. Mastering louder than the target gains nothing there and costs dynamic range.`
    )
  }

  return {
    loudness: integratedLoudness,
    target,
    gainDb,
    gainFactor,
    resultingTruePeak,
    wouldClip,
    platform,
    notes: Object.freeze([
      `${integratedLoudness} LUFS against a target of ${target}: apply ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(2)} dB, a factor of ${gainFactor.toFixed(4)}.`,
      platform === null ? 'Using the target given.' : `${platform.name}: target ${platform.target} LUFS, ceiling ${platform.ceiling} dBTP. ${platform.behaviour}`,
      'Loudness is not peak level. A heavily limited track can be far louder than a dynamic one with identical peaks, which is the whole reason LUFS exists.',
      'Integrated loudness is measured over the whole programme with gating. A short section can be much louder than the integrated figure suggests.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- print and resolution

export interface PrintReport {
  pixelWidth: number
  pixelHeight: number
  /** Inches and millimetres at the given density. */
  inches: { width: number; height: number }
  millimetres: { width: number; height: number }
  dpi: number
  megapixels: number
  /** The largest print at each common quality level. */
  atQuality: readonly { dpi: number; label: string; inchesWide: number; inchesHigh: number; suitableFor: string }[]
  /** Whether this has the pixels for the requested size. */
  enoughForRequested: boolean | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Print size from pixels and density, and the largest print at each quality level.
 *
 * DPI is the only link between pixels and inches, and an image file has no inherent physical size — the DPI written
 * in its metadata is a note about intent, not a property of the pixels. Resampling up adds pixels and no detail,
 * which is why the quality levels here are about what the original pixels support.
 */
export function printSize(input: {
  pixelWidth: number
  pixelHeight: number
  dpi?: number
  /** Inches, to check whether there are enough pixels. */
  requestedWidth?: number
  requestedHeight?: number
}): PrintReport | MediaError {
  const { pixelWidth, pixelHeight } = input
  for (const [name, value] of Object.entries({ pixelWidth, pixelHeight })) {
    if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const dpi = input.dpi ?? 300
  if (!finite(dpi) || dpi <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')

  const levels: readonly { dpi: number; label: string; suitableFor: string }[] = [
    { dpi: 300, label: 'press quality', suitableFor: 'Commercial printing, held at reading distance.' },
    { dpi: 240, label: 'good photo print', suitableFor: 'Photographic prints; the difference from 300 is hard to see.' },
    { dpi: 150, label: 'acceptable large print', suitableFor: 'Posters viewed from a metre or more.' },
    { dpi: 72, label: 'banner', suitableFor: 'Large-format work viewed from several metres.' }
  ]

  const warnings: string[] = []
  let enoughForRequested: boolean | null = null
  if (input.requestedWidth !== undefined && input.requestedHeight !== undefined) {
    const { requestedWidth, requestedHeight } = input
    if (!finite(requestedWidth) || !finite(requestedHeight) || requestedWidth <= 0 || requestedHeight <= 0) {
      return fail('invalid-argument', 'The requested size has to be greater than zero inches.')
    }
    const neededWidth = requestedWidth * dpi
    const neededHeight = requestedHeight * dpi
    enoughForRequested = pixelWidth >= neededWidth && pixelHeight >= neededHeight
    if (!enoughForRequested) {
      warnings.push(
        `A ${requestedWidth} by ${requestedHeight} inch print at ${dpi} dpi needs ${Math.ceil(neededWidth)} by ${Math.ceil(neededHeight)} pixels and this has ${pixelWidth} by ${pixelHeight}. Resampling up would add pixels and no detail.`
      )
    }
  }

  return {
    pixelWidth,
    pixelHeight,
    inches: { width: pixelWidth / dpi, height: pixelHeight / dpi },
    millimetres: { width: (pixelWidth / dpi) * 25.4, height: (pixelHeight / dpi) * 25.4 },
    dpi,
    megapixels: (pixelWidth * pixelHeight) / 1e6,
    atQuality: Object.freeze(
      levels.map((one) => ({
        dpi: one.dpi,
        label: one.label,
        inchesWide: pixelWidth / one.dpi,
        inchesHigh: pixelHeight / one.dpi,
        suitableFor: one.suitableFor
      }))
    ),
    enoughForRequested,
    notes: Object.freeze([
      `${pixelWidth} by ${pixelHeight} pixels at ${dpi} dpi prints at ${(pixelWidth / dpi).toFixed(2)} by ${(pixelHeight / dpi).toFixed(2)} inches, or ${((pixelWidth / dpi) * 25.4).toFixed(1)} by ${((pixelHeight / dpi) * 25.4).toFixed(1)} mm.`,
      'An image file has no inherent physical size. The DPI in its metadata is a note about intent rather than a property of the pixels, and changing it changes nothing about the image.',
      'Resampling up adds pixels and no detail. The sizes above are what the original pixels support.',
      'Viewing distance decides what resolution is enough. A billboard at 15 dpi looks fine from across the road and terrible from a metre away.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const MEDIA_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Frame rates are held as exact fractions. 29.97 is 30000/1001 and treating it as 30 drifts 3.6 seconds an hour.',
  'Drop-frame timecode skips frame numbers and never frames, and an invalid drop-frame timecode is refused rather than rounded to a valid one.',
  'File sizes are reported in both decimal and binary units, because both are in use and they differ by 4.9% per step.',
  'Size is exact arithmetic; whether a bitrate looks acceptable is not, and no formula here claims to give it.',
  'All three ways of fitting one aspect ratio into another are reported with their cost: bars, lost picture, or distortion.',
  'Square pixels are assumed. Some older video formats have non-square pixels and need the two ratios tracked separately.',
  'Loudness is not peak level, and raising loudness raises peaks by exactly as much. Without a true peak there is no clipping check and the result says so.',
  'An image has no inherent physical size. DPI is the only link between pixels and inches, and the DPI in a file is a note about intent.'
])
