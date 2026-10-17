/**
 * Bringing music in.
 *
 * Three ways, and all three mean one thing: a file the person already has. Orbis Music has no catalogue and nothing
 * here fetches audio from anywhere, so "bring in" never means download. A song is only ever marked as being on this
 * computer because a file was opened and understood, and its length came out of that file's own headers.
 *
 * **Why the picker belongs to the Orbis window and not to this page.** Choosing files and choosing a folder both open
 * the Orbis window's own dialog, and this page is told only how many files were added. That is on purpose: a browser
 * page knowing where a file lives on this computer is exactly what must not happen. The same reason is why a dragged
 * file is sent in pieces rather than by name -- the page is handed the contents and never a path.
 *
 * It follows that **no path is ever printed on this screen.** The answer to an import does carry the file names it
 * read, and the watched folders are a list of real paths, and neither is shown: the watched folders appear as a count
 * and an import appears as what it did. A page that printed them would be leaking the shape of somebody's disk into
 * a browser tab.
 */

import { countText } from '../../../src/shared/music/fulltab.ts'
import * as music from '../client.ts'
import { el, fill } from '../dom.ts'
import { registerScreen } from '../screens.ts'
import { doAndSay } from '../shell.ts'
import { block, card, figure, figures, press, reading, screenHead, unwrap } from './own-parts.ts'

/** The kinds of file Orbis can read. Checked here so a dropped picture is refused before anything is sent. */
const AUDIO = new Set(['mp3', 'm4a', 'mp4', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wave'])

/** How much of a file goes in one piece. The helper's channels are not meant for whole albums in one message. */
const PIECE = 3 * 1024 * 1024

const endOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * One piece of a file, as text.
 *
 * Built a kilobyte at a time rather than by spreading the whole piece into one call: three million arguments at once
 * is how a tab runs out of stack and dies, with nothing on screen saying why.
 */
function asText(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 8192) out += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return btoa(out)
}

/** What happened to a set of files, counted. Never the names: see the note at the top of this file. */
function importWords(answer: { added?: number; already?: number; failed?: number } | null): string {
  const added = answer?.added ?? 0
  const already = answer?.already ?? 0
  const failed = answer?.failed ?? 0
  if (added === 0 && already === 0 && failed === 0) return 'Nothing was added.'
  const parts = [`${countText(added, 'song', 'songs')} added`]
  if (already > 0) parts.push(`${already} already in your music`)
  if (failed > 0) parts.push(`${failed} could not be read`)
  return `${parts.join(', ')}.`
}

registerScreen({
  screen: 'bring-in',
  title: () => 'Bring music in',
  mount: (place) => {
    const countPlace = el('div', { cls: 'om-own-slot' }, [reading('music')])
    const dropPlace = el('div', { cls: 'om-own-slot' })
    const folderPlace = el('div', { cls: 'om-own-slot' }, [reading('settings')])
    let busy = false
    let depth = 0

    async function drawCounts(): Promise<void> {
      const answer = await music.now()
      const got = unwrap(answer, 'music')
      if ('problem' in got) {
        fill(countPlace, got.problem)
        return
      }
      const summary = got.value.summary
      fill(
        countPlace,
        figures([
          figure(String(summary.tracks), summary.tracks === 1 ? 'song' : 'songs'),
          figure(String(summary.offline), 'playable here'),
          // The reference count is how the "kept by name, no audio" idea stays visible wherever you are.
          figure(String(summary.reference), 'kept by name only'),
          summary.missing > 0 ? figure(String(summary.missing), 'files not where they were') : null
        ])
      )
    }

    async function drawFolders(): Promise<void> {
      const answer = await music.settings()
      const got = unwrap(answer, 'settings')
      if ('problem' in got) {
        fill(folderPlace, got.problem)
        return
      }
      const folders = got.value.folders ?? []
      fill(
        folderPlace,
        card('', [
          el('div', { cls: 'om-own-row-words' }, [
            el('span', {
              cls: 'om-own-row-label',
              text: folders.length === 0 ? 'No folders are being watched' : `${countText(folders.length, 'folder is', 'folders are')} being watched`
            }),
            el('span', {
              cls: 'om-own-row-detail',
              text:
                folders.length === 0
                  ? 'Point Orbis at a folder and anything you put in it from then on turns up in your music by itself.'
                  : 'Anything you put in them turns up in your music by itself. Which folders they are is not shown here: a browser page is never told where your files live.'
            })
          ]),
          el('div', { cls: 'om-own-acts' }, [
            press('Watch a folder', () => void withPicker(music.watchFolder()), 'primary', 'folder'),
            press('Stop reading', () => void doAndSay(music.run('stop-scan')), 'quiet')
          ])
        ])
      )
    }

    /**
     * Opens the Orbis window's own picker and says what came of it.
     *
     * The dialog is not on this page, so there is nothing on screen while it is open. The button is held meanwhile,
     * because pressing it twice would open two dialogs on a window somebody cannot see from here.
     */
    async function withPicker(doing: Promise<music.Answer<unknown>>): Promise<void> {
      if (busy) return
      busy = true
      place.note('The Orbis window is asking you to choose. Nothing is added until you do.')
      const answer = await doing
      busy = false
      if (!answer.got) {
        place.note(answer.why)
        return
      }
      place.note(importWords(answer.value as { added?: number; already?: number; failed?: number } | null))
      await Promise.all([drawCounts(), drawFolders()])
      place.refresh()
    }

    // ---- files dragged onto the screen ----

    function drawDrop(): void {
      fill(
        dropPlace,
        card('om-own-drop', [
          el('div', { cls: 'om-own-row-words' }, [
            el('span', { cls: 'om-own-row-label', text: 'Drop songs here' }),
            el('span', {
              cls: 'om-own-row-detail',
              text: 'Or choose them yourself. Orbis reads mp3, m4a, aac, flac, ogg, opus and wav. The file itself is never changed.'
            })
          ]),
          el('div', { cls: 'om-own-acts' }, [press('Choose files', () => void withPicker(music.importFiles()), 'primary', 'file')])
        ])
      )
    }

    /** Sends one dropped file in, in pieces, and answers whether it landed. */
    async function sendOne(file: File, which: number, total: number): Promise<boolean> {
      const key = `${Date.now().toString(36)}-${which}-${Math.random().toString(36).slice(2, 8)}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      for (let at = 0; at < Math.max(bytes.length, 1); at += PIECE) {
        const last = at + PIECE >= bytes.length
        place.note(`Adding ${which + 1} of ${total}: ${file.name}`)
        const answer = await music.sendFilePiece({ name: file.name, key, data: asText(bytes.subarray(at, at + PIECE)), last })
        if (!answer.got) {
          place.note(answer.why)
          return false
        }
        // A piece the service refused, in its own words. Carrying on would write half a file.
        const said = answer.value as { ok?: boolean; why?: string } | null
        if (said && said.ok === false) {
          place.note(said.why ?? `${file.name} could not be added.`)
          return false
        }
      }
      return true
    }

    async function dropped(files: readonly File[]): Promise<void> {
      if (busy) return
      const audio = files.filter((file) => AUDIO.has(endOf(file.name)))
      const skipped = files.length - audio.length
      if (audio.length === 0) {
        place.note(skipped > 0 ? 'None of those are audio files Orbis can read.' : 'There was nothing to add.')
        return
      }
      busy = true
      let added = 0
      for (let which = 0; which < audio.length; which++) {
        if (await sendOne(audio[which] as File, which, audio.length)) added += 1
      }
      busy = false
      place.note(
        `${countText(added, 'song', 'songs')} added${added < audio.length ? `, ${audio.length - added} could not be read` : ''}${skipped > 0 ? `, ${skipped} skipped as not audio` : ''}.`
      )
      await drawCounts()
      place.refresh()
    }

    fill(
      place.into,
      screenHead('Bring music in', 'Your own files, and nothing else. Orbis has no catalogue, so nothing here downloads anything.'),
      block('What you have now', 'Counted off your library.', [countPlace]),
      block('Add songs', 'One go, from files you choose or drop.', [dropPlace]),
      block('Watch a folder', 'Added once, kept up with from then on.', [folderPlace])
    )
    drawDrop()
    void drawCounts()
    void drawFolders()

    // Counted in and out rather than set and cleared, because dragging over a child element fires a leave on the
    // parent and the highlight would flicker all the way across the screen.
    const over = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
    }
    const enter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth += 1
      place.into.classList.add('om-own-dropping')
    }
    const leave = (): void => {
      depth = Math.max(depth - 1, 0)
      if (depth === 0) place.into.classList.remove('om-own-dropping')
    }
    const drop = (event: DragEvent): void => {
      event.preventDefault()
      depth = 0
      place.into.classList.remove('om-own-dropping')
      void dropped([...(event.dataTransfer?.files ?? [])])
    }
    place.into.addEventListener('dragover', over as EventListener)
    place.into.addEventListener('dragenter', enter as EventListener)
    place.into.addEventListener('dragleave', leave)
    place.into.addEventListener('drop', drop as EventListener)

    return {
      leave: () => {
        place.into.removeEventListener('dragover', over as EventListener)
        place.into.removeEventListener('dragenter', enter as EventListener)
        place.into.removeEventListener('dragleave', leave)
        place.into.removeEventListener('drop', drop as EventListener)
      }
    }
  }
})
