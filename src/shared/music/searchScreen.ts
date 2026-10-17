/**
 * The thinking behind the Search screen, with no screen attached.
 *
 * The Search screen itself is in `extension-src/music/screens/search.ts` and does nothing but draw. Everything here
 * is a plain answer to a plain question -- what to keep in the recent list, which name matches what somebody typed,
 * where the keyboard goes next, what sentence to show when a provider could not be asked -- so it can be tested with
 * no browser and no music library in the room.
 *
 * **None of this ranks anything.** The music engine already decides which rows are the best answer and which one is
 * clearly ahead (`src/shared/music/search.ts`), and a second opinion written here would be a second idea of what a
 * good match is. What is here instead is the narrow sorting a screen genuinely owns: filtering the person's own
 * albums, artists and genres by the words they typed, because those lists are not part of what the engine ranks.
 */

import type { Version } from './identity.ts'
import { versionLabel } from './identity.ts'

/** How many recent searches are kept. Short on purpose: a long list stops being recent and becomes a second library. */
export const MAX_RECENT_SEARCHES = 8

/** The longest the music service will read, so there is no point carrying more than this around. */
export const LONGEST_SEARCH = 300

/**
 * The words, tidied for asking.
 *
 * Collapsed whitespace and a length cap, because the service caps at 300 characters itself and cutting a search
 * short is better done here, where the box can show what was actually asked.
 */
export function searchable(said: unknown): string {
  if (typeof said !== 'string') return ''
  return said.replace(/\s+/g, ' ').trim().slice(0, LONGEST_SEARCH)
}

/** True when a search is worth keeping in the recent list. One letter is a keystroke, not a search. */
export const worthRemembering = (said: string): boolean => searchable(said).length >= 2

/**
 * The recent list, read back from wherever it was kept.
 *
 * Anything that is not a list of words is treated as nothing kept rather than as a fault: the list is a convenience,
 * and a page that refused to draw because its own stored list had gone odd would be worse than one that starts again.
 */
export function readRecentSearches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const one of raw) {
    const words = searchable(one)
    if (!words) continue
    if (out.some((held) => held.toLowerCase() === words.toLowerCase())) continue
    out.push(words)
    if (out.length >= MAX_RECENT_SEARCHES) break
  }
  return out
}

/**
 * The recent list with this search at the top.
 *
 * Matched without regard to case, so typing the same thing with a capital letter moves the one entry rather than
 * making a second that looks identical.
 */
export function rememberSearch(held: readonly string[], said: string): string[] {
  const words = searchable(said)
  if (!worthRemembering(words)) return [...held]
  const rest = held.filter((one) => one.toLowerCase() !== words.toLowerCase())
  return [words, ...rest].slice(0, MAX_RECENT_SEARCHES)
}

/** The recent list without this one entry. */
export function forgetSearch(held: readonly string[], said: string): string[] {
  const words = searchable(said).toLowerCase()
  return held.filter((one) => one.toLowerCase() !== words)
}

/**
 * Letters, numbers and single spaces, so punctuation in an album title does not stop a match.
 *
 * An apostrophe is dropped rather than turned into a space, because somebody typing "dont stop" means the song
 * called "Don't Stop Me Now" and a space there would split one word into two that neither side has.
 */
const plainly = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Whether a name is one of the things somebody was asking for.
 *
 * Every word has to appear somewhere in the name, in any order -- the same rule the library's own search uses -- so
 * "dark side" finds "The Dark Side of the Moon" and "moon dark" finds it too.
 */
export function matchesName(name: string, said: string): boolean {
  const words = plainly(searchable(said)).split(' ').filter(Boolean)
  if (words.length === 0) return false
  const flat = plainly(name)
  return words.every((word) => flat.includes(word))
}

/**
 * Where the keyboard goes next.
 *
 * Wraps at both ends, and answers -1 for an empty list so a caller can tell "nowhere to go" from "the first one".
 */
export function movePick(current: number, count: number, step: number): number {
  if (count <= 0) return -1
  if (current < 0) return step < 0 ? count - 1 : 0
  return (((current + step) % count) + count) % count
}

/**
 * The note for a search that was read as a description rather than as a name.
 *
 * Said out loud because the two searches behave completely differently: a description makes Orbis choose from the
 * music it has, and somebody who meant to look up a title needs to know that is what happened.
 */
export function describedWords(described: unknown): string | null {
  if (typeof described !== 'number' || !Number.isFinite(described) || described <= 0.5) return null
  return 'Read as a description, so Orbis chose from your own music rather than looking up a name.'
}

/** The note naming the words Orbis could not read, rather than quietly dropping them. */
export function notUnderstoodWords(words: unknown): string | null {
  if (!Array.isArray(words)) return null
  const kept = words.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map((one) => one.trim())
  if (kept.length === 0) return null
  return `Orbis could not read: ${kept.join(', ')}`
}

/** One row of the record of which providers answered. */
export interface AskedPlace {
  readonly id?: string
  readonly name?: string
  readonly ok?: boolean
  readonly ready?: boolean
  readonly reason?: string
}

/**
 * What to say about the places that could not be asked.
 *
 * A provider that was never set up and one that was asked and failed call for different sentences -- set it up, or
 * try again -- so they are never run together into "search failed".
 */
export function placesWords(asked: unknown): string[] {
  if (!Array.isArray(asked)) return []
  const out: string[] = []
  for (const one of asked as readonly AskedPlace[]) {
    if (!one || typeof one !== 'object' || one.ok === true) continue
    const name = typeof one.name === 'string' && one.name.trim() !== '' ? one.name.trim() : 'A music source'
    const reason = typeof one.reason === 'string' ? one.reason.trim() : ''
    if (one.ready === false) out.push(reason ? `${name}: ${reason}` : `${name} is not set up, so it was not asked.`)
    else out.push(reason ? `${name} could not be asked: ${reason}` : `${name} could not be asked this time.`)
  }
  return out
}

/** The sentence for a search that found nothing, when the service did not give one of its own. */
export function nothingFoundWords(said: string): { readonly title: string; readonly detail: string } {
  const words = searchable(said)
  return {
    title: words ? `Nothing in your music matches "${words}"` : 'Nothing matches',
    detail: 'Orbis searches the music on this computer. Bring some in, or try fewer words.'
  }
}

/** The version of a recording, in words, or nothing at all for an ordinary one. */
export function versionWords(version: unknown): string {
  if (!version || typeof version !== 'object') return ''
  const one = version as Version
  if (typeof one.kind !== 'string') return ''
  return versionLabel(one) || ''
}

/** Something of the person's own with a name and some tracks: an album, an artist, a genre. */
export interface NamedGroup {
  readonly name: string
  readonly by?: string
  readonly tracks: readonly { readonly id: string }[]
}

/**
 * The person's own groups that match what they typed, biggest first.
 *
 * Biggest first rather than closest-match first on purpose: this is a browse list, not a ranked answer, and an
 * artist with forty songs is far more likely to be the one meant than one with a single track whose name happens to
 * read as a closer match.
 */
export function matchingGroups<T extends NamedGroup>(groups: readonly T[], said: string, limit = 12): T[] {
  return groups
    .filter((one) => matchesName(one.name, said) || (one.by !== undefined && matchesName(one.by, said)))
    .slice()
    .sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}

/** Every group, biggest first, for the browse-all view with an empty box. */
export function biggestGroups<T extends NamedGroup>(groups: readonly T[], limit = 60): T[] {
  return groups
    .slice()
    .sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}
