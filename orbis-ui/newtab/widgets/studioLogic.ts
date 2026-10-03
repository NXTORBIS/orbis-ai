import { clampWidgetSetting, DEFAULT_LOOK, SIZE_NAMES, type WidgetDefinition, type WidgetInstance, type WidgetSettingSpec, type WidgetSize } from '../../../src/shared/widgets.ts'
import { columnsFor, GRID, SIZE_SPAN } from '../../../src/shared/widgetBoard.ts'

/**
 * The parts of the widget's own page and of the studio that are sums and words rather than drawing.
 *
 * A widget's settings are described once, in the catalogue. Everything here reads that description and nothing
 * else: which controls a form has, what a typed number comes to, what has changed between two sets of settings.
 * So a widget that gains a setting gains a control, and no form anywhere has to be told.
 *
 * Pure: no DOM, no clock, no storage.
 */

export type SettingValue = string | number | boolean
export type Settings = Record<string, SettingValue>

// ---------------------------------------------------------------- a definition's settings, as a form

/** The most choices that are laid side by side. More than this and they go in a list that opens. */
export const SIDE_BY_SIDE_MOST = 4

/** How long a text setting may be when the widget does not say. The same number the catalogue itself falls back on. */
export const TEXT_MOST = 300

export type FormField =
  | { kind: 'text'; name: string; label: string; value: string; maxLength: number; placeholder: string }
  | { kind: 'number'; name: string; label: string; value: number; min: number | null; max: number | null; whole: boolean; range: string }
  | { kind: 'switch'; name: string; label: string; value: boolean }
  | { kind: 'segmented' | 'select'; name: string; label: string; value: string; choices: { value: string; label: string }[] }

/**
 * The controls a widget's settings come to, in the order the widget lists them.
 *
 * A setting that is edited on the widget itself -- the words of a sticky note -- has no control: it would be a
 * second place to type the same thing. A choice with fewer than two things to choose from has none either, because
 * a control that cannot change anything is not a control.
 */
export function formFields(definition: WidgetDefinition, settings: Readonly<Record<string, unknown>>): FormField[] {
  const fields: FormField[] = []
  for (const spec of definition.settings) {
    if (spec.onCard) continue
    const value = clampWidgetSetting(spec, settings[spec.name])
    if (spec.type === 'text') fields.push({ kind: 'text', name: spec.name, label: spec.label, value: String(value), maxLength: spec.maxLength ?? TEXT_MOST, placeholder: spec.placeholder ?? '' })
    else if (spec.type === 'number') fields.push({ kind: 'number', name: spec.name, label: spec.label, value: Number(value), min: spec.min ?? null, max: spec.max ?? null, whole: wholeNumbers(spec), range: rangeWords(spec) })
    else if (spec.type === 'boolean') fields.push({ kind: 'switch', name: spec.name, label: spec.label, value: value === true })
    else {
      const choices = (spec.choices ?? []).map((one) => ({ value: one.value, label: one.label }))
      if (choices.length < 2) continue
      fields.push({ kind: choices.length <= SIDE_BY_SIDE_MOST ? 'segmented' : 'select', name: spec.name, label: spec.label, value: String(value), choices })
    }
  }
  return fields
}

/** The description of one setting, by name. */
export const specOf = (definition: WidgetDefinition, name: string): WidgetSettingSpec | null => definition.settings.find((spec) => spec.name === name) ?? null

/** Every setting a widget has, as it comes. */
export const defaultSettings = (definition: WidgetDefinition): Settings => Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, spec.default)]))

/** Every setting a widget has, each brought within what the widget takes. Anything it does not have is dropped. */
export const clampDraft = (definition: WidgetDefinition, draft: Readonly<Record<string, unknown>>): Settings =>
  Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, draft[spec.name])]))

/**
 * What is different in `after`, and only that.
 *
 * Both sides are brought within what the widget takes first, so "200" typed into a box that stops at 180 is not a
 * difference from 180, and a change that comes to nothing is sent to nobody.
 */
export function diffDraft(definition: WidgetDefinition, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Settings {
  const was = clampDraft(definition, before)
  const now = clampDraft(definition, after)
  return Object.fromEntries(definition.settings.filter((spec) => was[spec.name] !== now[spec.name]).map((spec) => [spec.name, now[spec.name]]))
}

/** Whether the settings a person can reach in the form are all as the widget comes. */
export const isAsItComes = (definition: WidgetDefinition, settings: Readonly<Record<string, unknown>>): boolean => {
  const changed = diffDraft(definition, defaultSettings(definition), settings)
  return definition.settings.every((spec) => spec.onCard || !(spec.name in changed))
}

/**
 * Whether a number setting counts in whole numbers.
 *
 * The catalogue does not say, but it shows: a setting that comes as 5 and runs from 1 to 20 is a count, and half a
 * headline is nobody's intention. One that comes as 0.5 is left as typed.
 */
export const wholeNumbers = (spec: WidgetSettingSpec): boolean => [spec.default, spec.min ?? 0, spec.max ?? 0].every((one) => typeof one === 'number' && Number.isInteger(one))

/** "From 1 to 180." -- what a number may be, or nothing when it may be anything. */
export function rangeWords(spec: Pick<WidgetSettingSpec, 'min' | 'max'>): string {
  if (spec.min !== undefined && spec.max !== undefined) return `From ${spec.min} to ${spec.max}.`
  if (spec.min !== undefined) return `${spec.min} or more.`
  if (spec.max !== undefined) return `${spec.max} or fewer.`
  return ''
}

export type NumberReading = { ok: true; value: number; note: string } | { ok: false; error: string }

/**
 * What was typed into a number box, as the number the widget will be given.
 *
 * Nothing, or something that is not a number, is not guessed at: it is an error in words and nothing is sent. A
 * number past either end is brought back to that end, and the note says so, so the box and the widget never show
 * two different numbers.
 */
export function readNumber(spec: WidgetSettingSpec, typed: string): NumberReading {
  const text = typed.trim()
  const asked = text === '' ? Number.NaN : Number(text)
  if (!Number.isFinite(asked)) {
    const range = rangeWords(spec)
    return { ok: false, error: range === '' ? 'Type a number.' : `Type a number. ${range}` }
  }
  const wanted = wholeNumbers(spec) ? Math.round(asked) : asked
  const value = Number(clampWidgetSetting(spec, wanted))
  if (spec.max !== undefined && wanted > spec.max) return { ok: true, value, note: `${spec.max} is the most.` }
  if (spec.min !== undefined && wanted < spec.min) return { ok: true, value, note: `${spec.min} is the least.` }
  return { ok: true, value, note: '' }
}

/** One step up or down from where a number stands, never past either end. */
export function stepNumber(spec: WidgetSettingSpec, from: number, by: 1 | -1): number {
  const start = Number.isFinite(from) ? from : Number(spec.default)
  return Number(clampWidgetSetting(spec, (wholeNumbers(spec) ? Math.round(start) : start) + by))
}

/** "12 characters left", once a text box is most of the way full. Nothing before that: a count on every box is noise. */
export function roomLeft(length: number, most: number): string {
  const left = most - length
  if (most <= 0 || left > Math.max(5, Math.floor(most / 5))) return ''
  if (left <= 0) return 'That is as much as fits.'
  return left === 1 ? '1 character left' : `${left} characters left`
}

// ---------------------------------------------------------------- facts, in words

/**
 * How often a widget looks again, as the end of a sentence: "every 30 minutes", "when something changes".
 *
 * In the largest unit that says it exactly enough to be true: ninety seconds is "every 90 seconds", not "every 2
 * minutes".
 */
export function refreshWords(refreshMs: number): string {
  if (!Number.isFinite(refreshMs) || refreshMs <= 0) return 'when something changes'
  const seconds = Math.max(1, Math.round(refreshMs / 1000))
  if (seconds === 1) return 'every second'
  if (seconds < 120 && seconds !== 60) return `every ${seconds} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes === 1) return 'every minute'
  if (minutes < 120 && minutes !== 60) return `every ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return 'every hour'
  if (hours < 48 && hours !== 24) return `every ${hours} hours`
  const days = Math.round(hours / 24)
  return days === 1 ? 'once a day' : `every ${days} days`
}

/** Whether a widget needs the internet, in the words the page uses. */
export const networkWords = (definition: Pick<WidgetDefinition, 'network'>): string => (definition.network ? 'Needs the internet for anything new' : 'Works with no connection')

/** "2 × 1" -- what a size measures in cells of the start page, across then down. A wide one is a whole row. */
export function sizeMeasure(size: WidgetSize): string {
  const span = SIZE_SPAN[size]
  return size === 'wide' ? `Full row × ${span.h}` : `${span.w} × ${span.h}`
}

/** The same, said aloud: "Medium, 2 cells across and 1 down". */
export function sizeSpoken(size: WidgetSize): string {
  if (size === 'wide') return `${SIZE_NAMES[size]}, a full row across and 1 cell down`
  const span = SIZE_SPAN[size]
  const cells = (n: number): string => (n === 1 ? '1 cell' : `${n} cells`)
  return `${SIZE_NAMES[size]}, ${cells(span.w)} across and ${span.h} down`
}

/**
 * The little picture of a size: a patch of the grid with the cells it covers filled in.
 *
 * Two cells by two is enough to tell small, medium, tall and large apart. A wide one is drawn on three across with
 * the whole top row filled, which is what "a full row" looks like on any page.
 */
export function sizeGlyph(size: WidgetSize): { columns: number; rows: number; w: number; h: number } {
  const span = SIZE_SPAN[size]
  const columns = size === 'wide' ? 3 : 2
  return { columns, rows: 2, w: Math.min(columns, span.w), h: Math.min(2, span.h) }
}

/** How many of a widget are on the start page: "1 on the start page", "3 on the start page". */
export const countWords = (count: number): string => `${count} on the start page`

/** Which one of several: "Small, place 2". Where it sits is the one thing that tells two of the same widget apart. */
export const placeWords = (instance: Pick<WidgetInstance, 'size'>, position: number): string => `${SIZE_NAMES[instance.size]}, place ${position + 1}`

// ---------------------------------------------------------------- the stage

/** The room kept clear around a widget on the stage, so its shadow has somewhere to fall. */
export const STAGE_PAD = 28

/** The smallest a widget is ever drawn on the stage. Below this it is a smudge, not a preview. */
export const STAGE_SMALLEST = 0.3

/** How big a size is in pixels on a page of this many columns. A widget wider than the page is as wide as the page. */
export function sizePixels(size: WidgetSize, columns: number): { width: number; height: number } {
  const span = SIZE_SPAN[size]
  const across = Math.min(span.w, Math.max(1, Math.floor(columns)))
  return { width: across * GRID.cell + (across - 1) * GRID.gap, height: span.h * GRID.cell + (span.h - 1) * GRID.gap }
}

export interface StageFit {
  /** The widget's real size on the start page, in pixels. It is drawn at this size whatever the scale. */
  width: number
  height: number
  /** How many columns it was measured against. Only a wide widget depends on this. */
  columns: number
  /** 1 when it fits as it is. Less when the stage is too small for it, and never more: a preview is not a magnifier. */
  scale: number
}

/**
 * The size a widget is drawn at on a stage, and how far it has to be shrunk to fit.
 *
 * A wide widget is a full row, so it is given as many columns as the stage has room for -- at least two, which is
 * the narrowest a wide widget ever is. A stage that has not been measured yet (nothing is laid out) shrinks nothing.
 */
export function stageFit(size: WidgetSize, stageWidth: number, stageHeight: number, pad: number = STAGE_PAD): StageFit {
  const room = (side: number): number => (Number.isFinite(side) ? Math.max(0, side - 2 * pad) : 0)
  const roomW = room(stageWidth)
  const roomH = room(stageHeight)
  const columns = size === 'wide' ? Math.max(2, columnsFor(roomW)) : SIZE_SPAN[size].w
  const { width, height } = sizePixels(size, columns)
  if (roomW === 0 || roomH === 0) return { width, height, columns, scale: 1 }
  const scale = Math.min(1, roomW / width, roomH / height)
  return { width, height, columns, scale: Math.max(STAGE_SMALLEST, Math.round(scale * 1000) / 1000) }
}

/** What to say about the scale: nothing is passed off as real size when it is not. */
export const scaleWords = (scale: number): string => (scale >= 0.995 ? 'Real size' : `Shown at ${Math.round(scale * 100)}% of real size`)

/**
 * The widget a preview is drawn from: the catalogue's widget at a chosen size with settings being tried.
 *
 * It is on nobody's start page and is never sent anywhere. Its id says so, and cannot be mistaken for a real one.
 */
export function previewInstance(definition: WidgetDefinition, size: WidgetSize, settings: Readonly<Record<string, unknown>>): WidgetInstance {
  return {
    id: `preview-${definition.id}`,
    widget: definition.id,
    zone: 'centre',
    order: 0,
    size: definition.sizes.includes(size) ? size : definition.defaultSize,
    settings: clampDraft(definition, settings),
    collapsed: false,
    disabled: false,
    locked: false,
    hidden: false,
    look: { ...DEFAULT_LOOK },
    addedAt: 0
  }
}

// ---------------------------------------------------------------- leaving

/**
 * Whether going back would stay on this page.
 *
 * The gallery lives in the page's address, so Back closes what was opened -- but only when the step before this one
 * was this same page. Opened straight at a widget's address, the step before is some other site or nothing at all,
 * and going back would take the person away from the start page they asked for.
 */
export function backStaysHere(entries: readonly { sameDocument: boolean }[], index: number): boolean {
  if (!Number.isInteger(index) || index <= 0 || index >= entries.length) return false
  return entries[index - 1].sameDocument === true
}
