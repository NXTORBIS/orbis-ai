import type { SettingsSectionId } from './settingsSections.ts'

/**
 * The feature screens the Orbis window has. Named here rather than imported from the window because this table is
 * about where things are, and that must stay testable without React anywhere near it. The window's own `FeatureId`
 * is checked against this list by a test, so the two cannot drift apart silently.
 */
export type WindowFeature = 'create' | 'pages' | 'markets' | 'whiteboard' | 'clipboard' | 'workspaces' | 'schedules' | 'notes'

/**
 * Where pressing a notification takes you.
 *
 * A notification says what happened and names what it happened to, by id. It does not say where that is -- deciding
 * that here, in one table, is what stops a notification carrying a route, which is the thing a payload could be bent
 * into something dangerous. The window reads the answer and goes there; nothing else decides.
 *
 * The rule the whole table is built on: **go to the thing, or say you cannot.** Bringing the window forward and
 * landing on whatever screen happened to be open is the failure this replaces -- it looks like the button worked and
 * it did not. So every destination below is a screen that really exists in the Orbis window today, and an event with
 * nowhere real to land returns `none`, which the window shows as a line in Activity rather than pretending.
 *
 * The ids travel with the destination so the screen can open the particular one -- that schedule, that conversation,
 * that file -- rather than the list it is in. A screen that cannot yet single one out still gets the id and ignores
 * it, which is honest; what it must never do is claim it went somewhere it did not.
 */

/** The screens in the Orbis window a notification can send somebody to. */
export type NotificationDestination =
  | { kind: 'feature'; id: WindowFeature; focus: string | null }
  | { kind: 'settings'; section: SettingsSectionId }
  | { kind: 'chat'; conversationId: string | null }
  | { kind: 'browser' }
  | { kind: 'activity' }
  | { kind: 'none' }

/** The first of these ids the notification carries is the thing to single out on arrival. */
const FOCUS_KEYS = ['scheduleId', 'workflowId', 'artifactId', 'pageId', 'ruleId', 'id', 'path', 'filename', 'name'] as const

function focusOf(subject: Readonly<Record<string, string>>): string | null {
  for (const key of FOCUS_KEYS) {
    const value = subject[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/**
 * Where an event goes.
 *
 * Takes the event name and the ids, and nothing else -- deliberately, so that no part of a notification's text can
 * influence where pressing it lands.
 */
export function destinationFor(event: string, subject: Readonly<Record<string, string>> = {}): NotificationDestination {
  const focus = focusOf(subject)
  const area = event.split('.')[0]

  switch (area) {
    // Things Orbis does at a time you chose, and the rules that fire on their own, are the same screen.
    case 'schedule':
    case 'rule':
      return { kind: 'feature', id: 'schedules', focus }

    // A file Orbis made. "Open" and "Show in folder" handle the file itself; this is the screen it was made on.
    case 'artifact':
      return { kind: 'feature', id: 'create', focus }

    case 'page':
      return { kind: 'feature', id: 'pages', focus }

    // Orion finishing, or waiting for an answer, belongs to the conversation it happened in.
    case 'orion':
    case 'research':
      return { kind: 'chat', conversationId: subject.conversationId ?? null }

    // These are all about a page in the browser: a workflow working on one, a page asking to verify a person, a tab
    // that wants attention, a download. The browser is where the thing is, so the browser is where this goes.
    case 'workflow':
    case 'captcha':
    case 'browser':
    case 'download':
      return { kind: 'browser' }

    case 'security':
      return { kind: 'settings', section: 'security' }

    case 'update':
      return { kind: 'settings', section: 'about' }

    // Something is wrong with Orbis itself. There is no screen for that; Activity is the list of what happened.
    case 'system':
      return { kind: 'activity' }

    default:
      return { kind: 'none' }
  }
}
