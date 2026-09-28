/**
 * Working out what "this", "that" and "the second one" are pointing at.
 *
 * Almost nothing anybody says to a browser names its subject outright. "Summarise this", "close that one", "open the
 * third result", "go back to the tab I had before", "make it darker" -- every one of them is a pointer into something
 * the person can see and the Orb has to reconstruct. Getting it wrong is not a small error: "close that one" aimed at
 * the wrong tab destroys work.
 *
 * So this resolves against what was actually perceived -- real tabs, the real page, the real selection, the real
 * results of earlier steps -- and returns nothing when it cannot. Nothing is the important case. An Orb that guesses
 * which tab you meant is worse than one that asks, because the guess is invisible until it has already acted.
 */

import type { Perception } from './orbTask.ts'

/** What a reference turned out to point at. */
export type Referent =
  | { kind: 'page'; url: string; title: string }
  | { kind: 'tab'; id: string; url: string; title: string }
  | { kind: 'selection'; text: string }
  | { kind: 'variable'; name: string; value: unknown }
  | { kind: 'ordinal'; index: number; of: string }

export interface Resolution {
  referent: Referent | null
  /** Said plainly, so a run can show what it decided a word meant. */
  because: string
  /** When nothing could be resolved: what to ask, in words a person can answer. */
  ask?: string
}

const ORDINALS: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9, last: -1
}

const THIS_PAGE = /\b(this|the current|the) (page|site|article|tab|document|screen)\b|\bhere\b/i
const SELECTION = /\b(this|the|my|highlighted) (selection|selected text|highlighted text)\b|\bwhat i('ve| have)? (selected|highlighted)\b/i
const PREVIOUS_TAB = /\b(previous|last|other|earlier) tab\b|\bthe tab (i had )?(before|previously)\b/i
const PREVIOUS_RESULT = /\b(that|the) (result|answer|one) (we|i) (just )?(found|got|had)\b|\bthe (previous|last) (result|answer|output)\b|\buse (that|the previous)\b/i
const IT = /^(it|that|this|them|those)\b/i

/** A word like "second" or "last", and what it was counting. Null when the words name no position. */
export function ordinalIn(text: string): { index: number; of: string } | null {
  const words = String(text ?? '').toLowerCase()
  const named = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+([a-z]+)/.exec(words)
  if (named) return { index: ORDINALS[named[1]], of: named[2] }
  const numbered = /\b(?:number\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/.exec(words)
  if (numbered) {
    const n = Number(numbered[1])
    if (n >= 1 && n <= 50) return { index: n - 1, of: numbered[2] }
  }
  return null
}

/**
 * Resolves the reference in a request, against what is really there.
 *
 * `recent` is what earlier steps produced, newest last, so "the previous result" means the last thing that actually
 * came back rather than the last thing anybody talked about.
 */
export function resolve(request: string, perception: Perception | null, variables: Record<string, unknown> = {}, recent: string[] = []): Resolution {
  const text = String(request ?? '')

  // ---- the selection, which is the most specific thing a person can be pointing at
  if (SELECTION.test(text)) {
    const selection = perception?.page?.selection?.trim()
    if (selection) return { referent: { kind: 'selection', text: selection }, because: 'the text selected on the page' }
    return { referent: null, because: 'nothing is selected', ask: 'Nothing is selected on the page. What should Orbis use?' }
  }

  // ---- an earlier result
  if (PREVIOUS_RESULT.test(text)) {
    const name = [...recent].reverse().find((n) => n in variables)
    if (name) return { referent: { kind: 'variable', name, value: variables[name] }, because: `the result of ${name}` }
    return { referent: null, because: 'nothing has been produced yet', ask: 'There is no earlier result to use yet. What should Orbis work from?' }
  }

  // ---- another tab
  if (PREVIOUS_TAB.test(text)) {
    const tabs = perception?.tabs ?? []
    const others = tabs.filter((t) => !t.active)
    if (others.length === 1) return { referent: { kind: 'tab', ...others[0] }, because: 'the only other tab open' }
    if (others.length > 1) {
      return {
        referent: null,
        because: `${others.length} other tabs are open`,
        ask: `There are ${others.length} other tabs. Which one? ${others.slice(0, 5).map((t, i) => `${i + 1}. ${t.title || t.url}`).join('  ')}`
      }
    }
    return { referent: null, because: 'there is no other tab', ask: 'There is no other tab open.' }
  }

  // ---- a position in something: "the third result", "the second tab"
  const ordinal = ordinalIn(text)
  if (ordinal) {
    if (/^tabs?$/.test(ordinal.of)) {
      const tabs = perception?.tabs ?? []
      const tab = ordinal.index === -1 ? tabs[tabs.length - 1] : tabs[ordinal.index]
      if (tab) return { referent: { kind: 'tab', ...tab }, because: `the ${ordinal.index === -1 ? 'last' : `#${ordinal.index + 1}`} tab` }
      return { referent: null, because: 'there is no tab in that position', ask: `There are ${tabs.length} tabs open.` }
    }
    // Something numbered that is not a tab -- a search result, an item in a list. The position is carried forward for
    // whoever holds that list; this file does not invent what it was counting.
    return { referent: { kind: 'ordinal', index: ordinal.index, of: ordinal.of }, because: `position ${ordinal.index + 1} in the ${ordinal.of}` }
  }

  // ---- the page in front
  if (THIS_PAGE.test(text)) {
    const page = perception?.page
    if (page?.url && /^https?:/i.test(page.url)) return { referent: { kind: 'page', url: page.url, title: page.title }, because: 'the page in front' }
    return { referent: null, because: 'there is no web page in front', ask: 'There is no web page open to work on.' }
  }

  // ---- a bare "it" or "that", which means whatever was last produced, or failing that the page
  if (IT.test(text.trim())) {
    const name = [...recent].reverse().find((n) => n in variables)
    if (name) return { referent: { kind: 'variable', name, value: variables[name] }, because: `the last result (${name})` }
    const page = perception?.page
    if (page?.url && /^https?:/i.test(page.url)) return { referent: { kind: 'page', url: page.url, title: page.title }, because: 'the page in front' }
    return { referent: null, because: 'nothing to point at', ask: 'What should Orbis work on?' }
  }

  return { referent: null, because: 'the request names its subject' }
}

/** True when a request leans on context rather than naming its subject, so the Orb knows it must resolve before acting. */
export const needsContext = (request: string): boolean => {
  const text = String(request ?? '')
  return THIS_PAGE.test(text) || SELECTION.test(text) || PREVIOUS_TAB.test(text) || PREVIOUS_RESULT.test(text) || IT.test(text.trim()) || ordinalIn(text) !== null
}

/**
 * A follow-up that changes the last thing rather than starting something new.
 *
 * "make it darker", "add a border", "try again with more detail" -- each carries the previous subject rather than
 * naming one. Recognising these is what lets an image be edited rather than a new one generated from four words.
 */
const FOLLOW_UP = /^(make|add|remove|change|try|do|redo|keep|use|continue|carry on|again|also|instead|now)\b|\b(instead|again|as well|too)\s*[.!]?$/i
export const isFollowUp = (request: string, hasPrevious: boolean): boolean => hasPrevious && FOLLOW_UP.test(String(request ?? '').trim())
