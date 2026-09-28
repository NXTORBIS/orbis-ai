/**
 * The Orbis omnibox: Chromium's real predictions, drawn Orbis's way.
 *
 * This is the consumer the native adapter existed for. Below it sit three things that were each already built and until
 * now were not joined to anything:
 *
 *   - `orbis_autocomplete.cc` in the browser, driving a genuine `AutocompleteController` with Chromium's own providers.
 *   - `omnibox-native.js`, this page's end of that: start, stop, listen, open.
 *   - `src/shared/omniboxNative.ts`, which merges those results with Orbis's own and decides the one list.
 *
 * What this file adds is the part a person actually touches: a list under the search box, keyboard handling, inline
 * completion, and the accessibility that makes any of it usable without a mouse. It computes no relevance and predicts
 * nothing -- every row it draws came from a real provider.
 *
 * The behaviours worth knowing about, because each one is a way to get this wrong:
 *
 *   - **Composition is respected.** While somebody is composing Tamil, Hindi or Japanese, keystrokes are not yet words.
 *     Predicting on them, or acting on Enter mid-composition, produces nonsense and can navigate somewhere unasked.
 *   - **Deleting does not get completions pushed back.** `preventInline` is true whenever the text got shorter, because
 *     filling the gap a person just made with backspace is the most irritating thing an omnibox can do.
 *   - **Enter follows Chromium's default match**, not whichever row is drawn first. The two can differ.
 *   - **The selection survives providers answering.** It follows its row if the row moves, and goes somewhere
 *     predictable if the row disappears -- never to whatever has taken its index.
 *   - **A late batch cannot change the list.** Generations, checked here as well as stamped in the browser.
 */

import {
  defaultOf,
  diagnose,
  fromOrbis,
  merge,
  preserveSelection
} from '../../src/shared/omniboxNative.ts'
import type { Candidate, Merged, NativeBatch, PredictionGroup } from '../../src/shared/omniboxNative.ts'
import * as native from './omnibox-native.js'
import { bindFocusShortcuts, createOmniboxFocus } from './omnibox-focus.ts'
import { createVoiceSession } from './voice-session.ts'
import type { VoiceUpdate } from './voice-session.ts'

export interface OmniboxHost {
  /** The input to attach to. */
  input: HTMLInputElement
  /** Where the list is drawn. Made if not given. */
  list?: HTMLElement
  /** Orbis's own suggestions for this text: workspaces, actions, open tabs. Empty when Orbis is not reachable. */
  orbisSuggestions?(text: string): Promise<{ id: string; kind: string; text: string; detail?: string; url?: string; query?: string; tabId?: string; workspaceId?: string; score: number }[]>
  /** Cached suggestions from a shorter input, for the head start. Never the final answer. */
  provisional?(text: string): string[]
  /** Searching, when the person takes a search row or submits plain words. */
  onSearch(query: string): void
  /** Ctrl+Enter: the same words, asked of Orion instead of searched. */
  onAskOrion(query: string): void
  /** Shift+Enter: open in the system's default browser. */
  onOpenExternally(target: string): void
  /** An Orbis row that is not a destination: a workspace, an action. */
  onOrbisAction?(candidate: Candidate): void
  /**
   * The helper channel, for the things the omnibox needs Orbis itself for.
   *
   * Only given where Orbis is reachable. Without it the omnibox still predicts and still navigates -- it simply does
   * not offer a microphone, because a microphone with nothing behind it is worse than none.
   */
  call?(channel: string, args?: unknown[]): Promise<unknown>
}

const MAX_ROWS = 8
/** Long enough not to ask on every keystroke of fast typing; short enough that the list feels immediate. */
const DEBOUNCE_MS = 90

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The small mark at the start of a row. Its own shape per kind, so a row's sort is readable at a glance. */
const GLYPH: Record<PredictionGroup, string> = {
  Search: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  History: 'M12 3a9 9 0 1 0 8.5 12H18.3A7 7 0 1 1 12 5v3l4-4-4-4z M11 8v5l4 2 .8-1.6-3.3-1.7V8z',
  Bookmarks: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  'Open Tabs': 'M3 5h18v14H3z M3 9h18 M8 5v4',
  Workspaces: 'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z',
  Actions: 'M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h12',
  'Site Search': 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4z M8 11h6',
  URLs: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z'
}

function glyph(group: PredictionGroup): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('d', GLYPH[group] ?? GLYPH.Search)
  svg.append(path)
  return svg
}

/** The site's own favicon where the page can have one, and the kind's mark otherwise. Never a fabricated logo. */
function mark(candidate: Candidate): HTMLElement {
  const box = el('span', 'omni-mark')
  box.append(glyph(candidate.group))
  // chrome://favicon2 is the browser's own cache: no network request of ours, and nothing invented when it has none.
  if (candidate.url && /^https?:/i.test(candidate.url) && location.protocol === 'chrome:') {
    const img = el('img')
    img.alt = ''
    img.width = 16
    img.height = 16
    img.src = `chrome://favicon2/?size=16&pageUrl=${encodeURIComponent(candidate.url)}`
    img.addEventListener('load', () => box.replaceChildren(img))
    // A favicon that fails to load leaves the kind's mark in place, which is the honest fallback.
  }
  return box
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** What the second line says. The page's own description where it has one, its site otherwise. */
function secondLine(candidate: Candidate): string {
  if (candidate.description) return candidate.description
  if (candidate.action === 'SWITCH_TAB') return `Switch to tab — ${candidate.url ? hostOf(candidate.url) : ''}`.trim()
  if (candidate.action === 'OPEN_WORKSPACE') return 'Open workspace'
  if (candidate.action === 'EXECUTE_ORBIS_ACTION') return 'Orbis'
  if (candidate.url) return hostOf(candidate.url)
  return candidate.action === 'SITE_SEARCH' ? 'Search this site' : 'Search'
}

export interface Omnibox {
  /** Closes the list without acting, and stops the native query. */
  dismiss(): void
  /** The one way anything asks for the address bar (see omnibox-focus.ts). */
  readonly focus: ReturnType<typeof createOmniboxFocus>
  /** Whether a microphone is actually usable here. */
  voiceAvailable(): boolean
  /** Starts or stops dictation into this omnibox, and nowhere else. */
  toggleVoice(): void
  /** What the list holds now, for tests and diagnosis. */
  state(): Merged | null
  /** A development-only account of the last query. */
  diagnostics(): unknown
  destroy(): void
}

export function mountOmnibox(host: OmniboxHost): Omnibox {
  const input = host.input
  const list = host.list ?? (() => {
    const made = el('div', 'omni-list')
    input.insertAdjacentElement('afterend', made)
    return made
  })()

  list.id = list.id || 'omni-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Predictions')
  list.hidden = true

  // The input announces itself as a combobox so a screen reader describes the list, the expanded state and which row is
  // current. Without these the list is a visual affordance only, which is not the same as being usable.
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'false')
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-autocomplete', 'both')
  const live = el('span', 'omni-live')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('role', 'status')
  list.insertAdjacentElement('afterend', live)

  let merged: Merged | null = null
  let lastInput: Parameters<typeof merge>[0] | null = null
  let selectedId: string | null = null
  let selected = -1
  let generation = 0
  let latestBatch: NativeBatch | null = null
  let composing = false
  let previousText = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let orbisRows: Candidate[] = []

  const rowId = (i: number): string => `${list.id}-row-${i}`

  // ---------------------------------------------------------------- focus, owned in one place
  const focus = createOmniboxFocus(() => input)
  const unbindShortcuts = bindFocusShortcuts(focus)
  // Clicking the box is an explicit request like any other, so it goes through the same door rather than calling
  // `focus()` directly. That is what keeps "who asked last" answerable.
  input.addEventListener('pointerdown', () => void focus.requestFocus({ reason: 'explicit', caret: 'keep', from: 'pointer' }))

  // ---------------------------------------------------------------- the microphone
  //
  // Offered only when Orbis is reachable *and* this page can actually record. A microphone that cannot transcribe is
  // worse than no microphone: it invites somebody to speak and then loses what they said.
  const mic = el('button', 'omni-mic')
  mic.type = 'button'
  mic.hidden = true
  mic.setAttribute('aria-label', 'Dictate into the address bar')
  mic.title = 'Dictate into the address bar'
  const micGlyph = (): SVGSVGElement => {
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.7')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('aria-hidden', 'true')
    const body = document.createElementNS(NS, 'path')
    body.setAttribute('d', 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z')
    const arc = document.createElementNS(NS, 'path')
    arc.setAttribute('d', 'M5 11a7 7 0 0 0 14 0M12 18v3')
    svg.append(body, arc)
    return svg
  }
  mic.append(micGlyph())
  input.insertAdjacentElement('afterend', mic)

  /** Said to the person, never a code and never a stack trace. */
  const say = (message: string): void => {
    live.textContent = message
  }

  const voice = host.call
    ? createVoiceSession({
        target: 'url-bar',
        call: host.call,
        onUpdate: (update: VoiceUpdate) => {
          mic.dataset.state = update.state
          mic.classList.toggle('on', update.state === 'listening')
          mic.classList.toggle('busy', update.state === 'requesting-permission' || update.state === 'initializing' || update.state === 'processing')
          mic.setAttribute('aria-pressed', String(update.state === 'listening'))

          if (update.error) {
            // Concise and actionable. The code stays internal; the sentence is the one voiceInput.ts writes for people.
            say(update.error.message)
            mic.setAttribute('aria-label', 'Dictate into the address bar')
            return
          }
          if (update.state === 'listening') {
            mic.setAttribute('aria-label', 'Stop dictating')
            say('Listening.')
            return
          }
          if (update.state === 'processing') {
            say('Working out what you said…')
            return
          }
          mic.setAttribute('aria-label', 'Dictate into the address bar')

          if (!update.text) return
          /**
           * The words, into the same pipeline typing uses.
           *
           * Deliberately not a shortcut straight to a search. A transcript is input, not a command: it lands in the
           * box, the caret goes after it, predictions run on it, and the person reads it before anything happens. That
           * is also what makes a misheard word recoverable -- they can edit it like any other text.
           */
          input.value = update.text
          previousText = input.value
          void focus.requestFocus({ reason: 'explicit', caret: 'end', from: 'voice' })
          ask()
          say(`Heard: ${update.text}`)
        }
      })
    : null

  if (voice?.available()) mic.hidden = false

  const toggleVoice = (): void => {
    if (!voice) return
    if (voice.state() === 'listening') void voice.stop()
    else void voice.start()
  }
  mic.addEventListener('click', (e) => {
    e.preventDefault()
    toggleVoice()
  })

  function draw(): void {
    list.replaceChildren()
    const candidates = merged?.candidates ?? []
    if (!candidates.length) {
      list.hidden = true
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
      return
    }

    let group: PredictionGroup | null = null
    candidates.forEach((candidate, i) => {
      // A heading only when the group changes, and never for a group with nothing in it -- the merge already dropped
      // those, so there is nothing to guard against here beyond not repeating a heading.
      if (candidate.group !== group) {
        group = candidate.group
        const heading = el('div', 'omni-group', group)
        heading.setAttribute('role', 'presentation')
        list.append(heading)
      }
      const row = el('div', `omni-row${i === selected ? ' on' : ''}`)
      row.id = rowId(i)
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(i === selected))
      row.append(mark(candidate))
      const words = el('span', 'omni-words')
      words.append(el('span', 'omni-title', candidate.text), el('span', 'omni-detail', secondLine(candidate)))
      row.append(words)
      if (candidate.keyword) {
        // Tab-to-search, announced rather than left to be discovered.
        row.append(el('span', 'omni-tab-hint', 'Tab'))
      }
      // Pointer down rather than click: a click after the input loses focus can arrive when the list has already closed.
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        take(candidate)
      })
      row.addEventListener('pointerenter', () => {
        selected = i
        selectedId = candidate.id
        mark_selection()
      })
      list.append(row)
    })

    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    mark_selection()
    // Said once per settled list rather than on every batch, so a screen reader is not interrupted mid-sentence.
    if (merged?.settled) live.textContent = `${candidates.length} prediction${candidates.length === 1 ? '' : 's'}`
  }

  function mark_selection(): void {
    for (const [i, row] of [...list.querySelectorAll('.omni-row')].entries()) {
      row.classList.toggle('on', i === selected)
      row.setAttribute('aria-selected', String(i === selected))
    }
    if (selected >= 0) input.setAttribute('aria-activedescendant', rowId(selected))
    else input.removeAttribute('aria-activedescendant')
  }

  /** Recomputes the one list from everything currently known, and keeps the selection on its row. */
  function recompute(): void {
    const text = input.value
    lastInput = {
      text,
      generation,
      native: latestBatch,
      orbis: orbisRows,
      provisional: host.provisional?.(text) ?? [],
      limit: MAX_ROWS
    }
    merged = merge(lastInput)
    selected = preserveSelection(selectedId, merged.candidates)
    selectedId = selected >= 0 ? merged.candidates[selected].id : null
    draw()
  }

  const stopNative = native.onResults((batch: NativeBatch) => {
    // Checked here as well as stamped in the browser: a notification already in flight cannot be recalled.
    if (batch.generation !== generation) return
    latestBatch = batch
    recompute()
  })

  function ask(): void {
    const text = input.value
    if (!text.trim()) {
      latestBatch = null
      orbisRows = []
      merged = null
      selected = -1
      selectedId = null
      native.stop({ keep: false })
      draw()
      return
    }

    // Shorter than before means deleting, and deleting must not have a completion pushed back into the gap.
    const preventInline = text.length < previousText.length
    previousText = text

    generation = native.start(text, { cursor: input.selectionStart ?? text.length, preventInline })
    // Without the native pipeline there is still Orbis's own list; the merge is told so and keeps everything.
    latestBatch = null
    recompute()

    void host
      .orbisSuggestions?.(text)
      .then((suggestions) => {
        // The generation guard applies to Orbis's own sources too: they are no faster than anything else.
        if (!suggestions || generation !== (lastInput?.generation ?? generation)) return
        orbisRows = fromOrbis(suggestions, { generation, nativeAvailable: native.available() })
        recompute()
      })
      .catch(() => {
        // Orbis being unreachable is not a reason to show nothing: the native rows stand on their own.
      })
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      ask()
    }, DEBOUNCE_MS)
  }

  /** Acting on a row: the action the row says it is, never one inferred from how it looks. */
  function take(candidate: Candidate): void {
    dismiss()
    switch (candidate.action) {
      case 'SEARCH':
        host.onSearch(candidate.query ?? candidate.text)
        return
      case 'SITE_SEARCH':
      case 'NAVIGATE_URL':
      case 'OPEN_HISTORY':
      case 'OPEN_BOOKMARK':
      case 'SWITCH_TAB':
        // Through the native pipeline by index, so the browser looks the match up and uses its own destination and
        // transition. A page naming its own destination would be a way to navigate anywhere as though it were typed.
        if (candidate.nativeIndex !== undefined && native.available()) {
          void native.open(candidate.nativeIndex).catch(() => {
            // The index went stale as providers answered. Searching the words is the safe fallback, and never a guessed
            // navigation: opening the wrong page is worse than opening none.
            host.onSearch(input.value)
          })
          return
        }
        if (candidate.url) host.onOpenExternally(candidate.url)
        else host.onSearch(candidate.query ?? candidate.text)
        return
      default:
        host.onOrbisAction?.(candidate)
    }
  }

  function move(by: number): void {
    const candidates = merged?.candidates ?? []
    if (!candidates.length) return
    selected = selected < 0 ? (by > 0 ? 0 : candidates.length - 1) : (selected + by + candidates.length) % candidates.length
    selectedId = candidates[selected].id
    // Freeze the list while somebody is arrowing through it: Chromium's own behaviour, and it stops rows moving underfoot.
    native.stop({ keep: true })
    mark_selection()
    const row = list.querySelector(`#${CSS.escape(rowId(selected))}`)
    row?.scrollIntoView({ block: 'nearest' })
  }

  function dismiss(): void {
    if (timer) clearTimeout(timer)
    timer = null
    merged = null
    selected = -1
    selectedId = null
    latestBatch = null
    native.stop({ keep: false })
    draw()
  }

  // ---- composition. While composing, a keystroke is not yet a word.
  input.addEventListener('compositionstart', () => {
    composing = true
  })
  input.addEventListener('compositionend', () => {
    composing = false
    // Now it is a word, so now it is worth asking about.
    schedule()
  })

  input.addEventListener('input', () => {
    if (composing) return
    schedule()
  })

  input.addEventListener('keydown', (e) => {
    // Enter mid-composition commits the composition; it is not a request to navigate.
    if (composing || e.isComposing) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
      return
    }
    if (e.key === 'Escape') {
      // Dictation first: somebody pressing Escape while the microphone is open means the microphone.
      if (voice && voice.state() === 'listening') {
        e.preventDefault()
        e.stopPropagation()
        voice.cancel()
        say('Dictation cancelled.')
        return
      }
      if (!list.hidden) {
        // The list closes; nothing is acted on. Escape must never be a way to open something.
        e.preventDefault()
        e.stopPropagation()
        dismiss()
      }
      return
    }
    if (e.key === 'Tab') {
      const row = selected >= 0 ? merged?.candidates[selected] : defaultOf(merged ?? { candidates: [], groups: [], settled: false, provisional: false, generation })
      if (row?.keyword) {
        // Tab-to-search: Chromium's keyword mode, entered by putting the keyword in the box and asking again.
        e.preventDefault()
        input.value = `${row.keyword} `
        previousText = input.value
        generation = native.start(input.value, { cursor: input.value.length, keywordMode: true })
        latestBatch = null
        recompute()
      }
      return
    }

    if (e.key !== 'Enter') return

    // Ctrl+Enter is Orion, and must not also navigate. Checked before anything else Enter could mean.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      const words = input.value.trim()
      dismiss()
      if (words) host.onAskOrion(words)
      return
    }
    // Shift+Enter is the system browser, and must not also navigate here.
    if (e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      const row = selected >= 0 ? merged?.candidates[selected] : null
      const target = row?.url ?? input.value.trim()
      dismiss()
      if (target) host.onOpenExternally(target)
      return
    }

    // A row the person chose, or the one Chromium considers default -- never simply the first drawn.
    const chosen = selected >= 0 ? merged?.candidates[selected] : merged ? defaultOf(merged) : null
    if (chosen) {
      e.preventDefault()
      e.stopPropagation()
      take(chosen)
    }
    // With no predictions at all, the form's own submit handles it: plain words, searched.
  })

  input.addEventListener('blur', () => {
    // A moment, so a pointerdown on a row is not lost to the blur that precedes it.
    setTimeout(() => {
      if (!list.contains(document.activeElement)) dismiss()
    }, 120)
  })

  return {
    dismiss,
    focus,
    voiceAvailable: () => Boolean(voice?.available()),
    toggleVoice,
    state: () => merged,
    diagnostics: () => (lastInput && merged ? diagnose(lastInput, merged) : null),
    destroy() {
      stopNative()
      unbindShortcuts()
      voice?.cancel()
      focus.destroy()
      if (timer) clearTimeout(timer)
      native.stop({ keep: false })
      mic.remove()
      list.remove()
      live.remove()
    }
  }
}
