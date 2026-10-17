/**
 * The keyboard, and the sheet that lists what it does.
 *
 * Both come out of one table, `SHORTCUTS` in src/shared/music/actions.ts. A press is matched against it and the sheet
 * is worked out from it, so a shortcut that works and is written down nowhere cannot happen -- and neither can a sheet
 * that promises a key that does nothing. That was the whole reason for putting the table somewhere with no screen
 * near it: there is no second list here to keep in step.
 *
 * Three things this file is careful about.
 *
 * **It gets out of the way of typing.** A press while the focus is in a box, or on a slider, or in a menu, is not a
 * shortcut. Space on a button presses the button. The arrow keys on the seek and volume bars are the browser's own,
 * and they already work, so they are left alone.
 *
 * **It never holds Ctrl or Alt.** Those belong to the browser. A music page that quietly took Ctrl+F or Alt+Left away
 * from somebody would be worse than a page with no shortcuts at all.
 *
 * **Every press is read back from the player.** Seeking forward works out where to seek to from where the music
 * actually is, not from where this page last drew the bar, and then asks the player again -- the same path a press on
 * the player bar takes.
 */

import { SEEK_JUMP, SEEK_STEP, VOLUME_STEP, shortcutFor, shortcutSheet, type ShortcutId } from '../../src/shared/music/actions.ts'
import { nextRepeat } from '../../src/shared/music/fulltab.ts'
import * as music from './client.ts'
import { button, el } from './dom.ts'
import { icon } from './icons.ts'
import * as player from './player.ts'
import { go } from './router.ts'
import { doAndSay, note } from './shell.ts'

// ---------------------------------------------------------------- the sheet

let sheet: HTMLElement | null = null

export function closeSheet(): void {
  sheet?.remove()
  sheet = null
}

/**
 * Shows the list of shortcuts.
 *
 * Built from `shortcutSheet()` every time it is opened rather than once, so it is right even if the table is ever
 * added to while the page is open.
 */
export function showSheet(): void {
  if (sheet) {
    closeSheet()
    return
  }
  const groups = shortcutSheet().map((group) =>
    el('section', { cls: 'om-sheet-group' }, [
      el('h3', { cls: 'om-sheet-head', text: group.group }),
      el(
        'dl',
        { cls: 'om-sheet-rows' },
        group.rows.flatMap((row) => [
          el('dt', { cls: 'om-sheet-keys' }, row.keys.map((key) => el('kbd', { cls: 'om-key', text: key }))),
          el('dd', { cls: 'om-sheet-does', text: row.does })
        ])
      )
    ])
  )
  const box = el('div', { cls: 'om-sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' } }, [
    el('div', { cls: 'om-sheet-top' }, [
      el('h2', { cls: 'om-sheet-title', text: 'Keyboard shortcuts' }),
      button({ cls: 'om-icon', title: 'Close', onClick: closeSheet }, [icon('close', 18)])
    ]),
    ...groups,
    el('p', { cls: 'om-sheet-note', text: 'None of these work while you are typing in a box.' })
  ])
  const cover = el('div', { cls: 'om-cover' }, [box])
  cover.addEventListener('click', (event) => {
    if (event.target === cover) closeSheet()
  })
  cover.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.preventDefault()
      closeSheet()
    }
  })
  document.body.append(cover)
  sheet = cover
  const close = box.querySelector('.om-icon')
  if (close instanceof HTMLElement) close.focus()
}

// ---------------------------------------------------------------- doing one press

/** Where to seek to, worked out from where the music actually is now. Null when the track has no known length. */
function seekTo(by: number): number | null {
  const playback = player.current().music?.playback
  if (!playback || !(playback.duration > 0)) return null
  const at = player.positionNow() + by
  return Math.max(0, Math.min(playback.duration, at))
}

function changeVolume(by: number): void {
  const level = Math.max(0, Math.min(1, player.volumeNow() + by))
  void doAndSay(music.setVolume(level))
}

function doShortcut(id: ShortcutId): void {
  const playback = player.current().music?.playback
  switch (id) {
    case 'play-pause':
      if (playback?.owner === 'website') {
        // A web page's player belongs to the page. Orbis can say what is playing and never touches the controls.
        note('That player belongs to the web page. Orbis leaves it alone.')
        return
      }
      void doAndSay(music.playOrPause())
      return
    case 'back-a-bit':
    case 'on-a-bit':
    case 'back-a-lot':
    case 'on-a-lot': {
      const by = (id === 'back-a-bit' ? -SEEK_STEP : id === 'on-a-bit' ? SEEK_STEP : id === 'back-a-lot' ? -SEEK_JUMP : SEEK_JUMP)
      const at = seekTo(by)
      if (at === null) {
        note(playback?.trackId ? 'This track has no known length, so there is nowhere to seek to.' : 'Nothing is playing.')
        return
      }
      void doAndSay(music.seek(at))
      return
    }
    case 'louder':
      changeVolume(VOLUME_STEP)
      return
    case 'quieter':
      changeVolume(-VOLUME_STEP)
      return
    case 'mute':
      void doAndSay(music.setMuted(playback?.muted !== true))
      return
    case 'next':
      void doAndSay(music.next())
      return
    case 'previous':
      void doAndSay(music.previous())
      return
    case 'shuffle':
      void doAndSay(music.setShuffle(playback?.shuffle !== true))
      return
    case 'repeat':
      void doAndSay(music.setRepeat(nextRepeat(playback?.repeat ?? 'off')))
      return
    case 'favourite': {
      const track = player.current().music?.track
      if (!track) {
        note('Nothing is playing.')
        return
      }
      void doAndSay(music.setFavourite(track.id, track.favourite !== true))
      return
    }
    case 'search':
      go('search')
      return
    case 'sheet':
      showSheet()
      return
    default:
      return
  }
}

// ---------------------------------------------------------------- when a press is not a shortcut

/**
 * Whether this press belongs to whatever has the focus rather than to the music.
 *
 * A box being typed in, a slider being nudged, a menu being walked through with the arrow keys, and Space or Enter on
 * a button all mean the press is already somebody's. The seek and volume bars are real range inputs, so their arrow
 * keys are the browser's own and work without anything here.
 */
function belongsToTheFocus(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // Inside a menu or one of the small boxes that asks a question: those have their own keys.
  if (target.closest('.om-menu, .om-cover')) return true
  if ((event.key === ' ' || event.key === 'Enter') && (tag === 'BUTTON' || tag === 'A' || target.getAttribute('role') === 'button')) return true
  return false
}

/**
 * Starts listening for presses.
 *
 * One listener on the page, not one per screen, so a screen cannot grow its own idea of what Space means. A press that
 * is one of ours is stopped from going any further -- Space would otherwise scroll the page as well as pause the
 * music, which looks like two things happening to one press.
 */
export function startShortcuts(): void {
  addEventListener('keydown', (event) => {
    if (event.repeat && event.key === ' ') return
    if (belongsToTheFocus(event)) return
    const shortcut = shortcutFor({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey })
    if (!shortcut) return
    event.preventDefault()
    doShortcut(shortcut.id)
  })
}
