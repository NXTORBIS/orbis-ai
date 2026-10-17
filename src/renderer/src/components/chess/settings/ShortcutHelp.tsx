import { useMemo } from 'react'
import { Modal } from '../../../ui'
import {
  ALL_SHORTCUTS,
  APP_SHORTCUTS,
  BOARD_ACCESS_NOTES,
  BOARD_KEYS,
  CHESS_SHORTCUTS,
  SCOPE_NAME,
  chordFace,
  conflictsIn,
  describeConflict,
  type AccessNote,
  type Shortcut,
  type ShortcutScope
} from '../../../../../shared/chess/settings'
import './chessSettings.css'

/**
 * Every key Chess World answers, and the truth about using it without a mouse.
 *
 * Two halves on purpose.
 *
 * The first is the map: the chords, grouped by where the keyboard has to be for each one to work, which is the
 * thing a flat list of shortcuts never tells you. Half of chess is the arrow keys, and the arrow keys do two
 * different things depending on whether the board has the keyboard -- so the sheet is organised by the question
 * that actually decides what will happen.
 *
 * The second is what does not work. `Board.tsx` belongs to another part of this build, so those are findings and
 * not fixes, and they are in the product rather than only in a report because somebody who cannot see the screen
 * needs to know today which of them are true. Being told plainly that a finished game cannot be read square by
 * square is worth a great deal more than finding out by trying for ten minutes.
 *
 * Built on the window's shared dialog, so Escape closes it and the keyboard stays inside it -- neither of which is
 * true of a dialog written by hand, and the second of which is the reason the shared one exists.
 */

const ORDER: readonly ShortcutScope[] = ['chess-screen', 'chess-board', 'chess-move-list', 'chess-shortcut-sheet', 'window']

const STATE_WORD: Readonly<Record<AccessNote['state'], string>> = {
  works: 'works',
  partly: 'partly',
  missing: 'not there yet'
}

function KeyList({ keys }: { keys: readonly Shortcut[] }): React.JSX.Element {
  return (
    <ul className="cw-cfg-keylist">
      {keys.map((one) => (
        <li className={`cw-cfg-key${one.answered ? '' : ' is-unanswered'}`} key={one.id}>
          <kbd className="cw-cfg-chord">{chordFace(one.chord)}</kbd>
          <span className="cw-cfg-does">
            {one.action}
            {/*
              * A chord nothing listens for says so on its own line, in the place somebody reads before they press
              * it. It is not quietly dropped from the list: knowing that the key exists and does nothing yet is
              * worth more than wondering whether you pressed it wrong.
              */}
            {!one.answered && <strong className="cw-cfg-nothing">Nothing answers this yet.</strong>}
            {(one.when ?? one.description) && <small>{[one.description, one.when].filter((bit) => bit).join(' ')}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }): React.JSX.Element {
  /*
   * The clashes, worked out here rather than written down. Two keys in one place is a bug and the sheet says so
   * out loud; the same key in two nested places is a decision, and the sheet explains which one wins where.
   */
  const { clashes, nested } = useMemo(() => {
    const all = conflictsIn(ALL_SHORTCUTS)
    return {
      clashes: all.filter((one) => one.kind === 'same-place'),
      nested: all.filter((one) => one.kind === 'nested-place')
    }
  }, [])

  const byScope = useMemo(
    () => ORDER.map((scope) => ({
      scope,
      keys: [...CHESS_SHORTCUTS, ...BOARD_KEYS, ...APP_SHORTCUTS].filter((one) => one.scope === scope)
    })).filter((one) => one.keys.length > 0),
    []
  )

  return (
    <Modal label="Chess World keys" title="Keys" onClose={onClose}>
      <div className="cw-cfg-keys">
        <p className="cw-cfg-keys-say">
          Where the keyboard is decides what a key does. Every key below says which of the three places it belongs
          to. The single-letter ones only work when you are not typing in a box.
        </p>

        {byScope.map((set) => (
          <section className="cw-cfg-keyset" key={set.scope} aria-label={SCOPE_NAME[set.scope]}>
            <h3 className="cw-cfg-keyset-name">{SCOPE_NAME[set.scope]}</h3>
            <KeyList keys={set.keys} />
          </section>
        ))}

        {clashes.length > 0 && (
          <div className="cw-cfg-warn" role="alert">
            <strong>These keys are claimed twice in one place, so one of each pair never happens:</strong>
            <ul>
              {clashes.map((one) => (
                <li key={`${one.chord}-${one.entries.map((e) => e.id).join('-')}`}>{describeConflict(one)}</li>
              ))}
            </ul>
          </div>
        )}

        {nested.length > 0 && (
          <section className="cw-cfg-keyset" aria-label="Keys that do two things">
            <h3 className="cw-cfg-keyset-name">Keys that do two things</h3>
            <ul className="cw-cfg-keylist">
              {nested.map((one) => (
                <li className="cw-cfg-key" key={`${one.chord}-${one.entries.map((e) => e.id).join('-')}`}>
                  <kbd className="cw-cfg-chord">{chordFace(one.chord)}</kbd>
                  <span className="cw-cfg-does">{describeConflict(one)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="cw-cfg-keyset" aria-label="Using the board without a mouse">
          <h3 className="cw-cfg-keyset-name">Using the board without a mouse, or without the screen</h3>
          <p className="cw-cfg-keys-say">
            This is what Orbis found when the board was read closely, including what is missing. It is written down
            rather than left out, because the parts that do not work are the parts worth knowing about first.
          </p>
          <ul className="cw-cfg-notes">
            {BOARD_ACCESS_NOTES.map((note) => (
              <li className={`cw-cfg-note ${note.state}`} key={note.what}>
                <span className="cw-cfg-note-what">
                  {note.what}
                  <span className="cw-cfg-state">{STATE_WORD[note.state]}</span>
                </span>
                <p className="cw-cfg-note-say">{note.detail}</p>
                {note.needs !== undefined && <p className="cw-cfg-note-needs">What would fix it: {note.needs}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}

export default ShortcutHelp
