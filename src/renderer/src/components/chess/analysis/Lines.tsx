import { useMemo, useState } from 'react'
import { Button, EmptyState, Segmented } from '../../../ui'
import { Compare } from './Compare'
import { branchList, sortBranches, STUDY_CAPS, type BranchOrder } from '../../../../../shared/chess/study'
import { compareEnds } from '../../../../../shared/chess/compare'
import type { AnalysisSession } from '../../../../../shared/chess/analysis'

/**
 * The lines in this analysis, as a list: named, sorted, and two of them compared (Sections 126, 128).
 *
 * The move list beside the board shows the same tree nested, which is the right shape for reading a game and the
 * wrong shape for finding the line you called "the king-side attack" in a study with forty branches in it. So this
 * is the same tree as a flat list, with a name on each branch that wants one.
 *
 * A name is extra. The moves are still the moves, a branch with no name reads exactly as it did, and nothing is
 * ordered by the name unless somebody asks for that. There is no cap on how many branches a position may have.
 */

const ORDERS: { value: BranchOrder; label: string }[] = [
  { value: 'where', label: 'In order' },
  { value: 'name', label: 'By name' },
  { value: 'length', label: 'Longest first' }
]

export interface LinesProps {
  session: AnalysisSession
  orientation: 'w' | 'b'
  onJump: (nodeId: string) => void
  /** An empty name clears it: a branch with no name is not a branch named "". */
  onLabel: (nodeId: string, label: string) => void
}

export function Lines({ session, orientation, onJump, onLabel }: LinesProps): React.JSX.Element {
  const [order, setOrder] = useState<BranchOrder>('where')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const branches = useMemo(() => sortBranches(branchList(session), order), [session, order])
  const here = picked.filter((id) => session.tree.nodes[id])
  const comparison = useMemo(
    () => (here.length === 2 ? compareEnds(session, here[0], here[1]) : null),
    [session, here[0], here[1], here.length]
  )

  const pick = (nodeId: string): void => {
    setPicked((before) => {
      if (before.includes(nodeId)) return before.filter((id) => id !== nodeId)
      // Two at a time: a third replaces the first, so picking never silently does nothing.
      return [...before, nodeId].slice(-2)
    })
  }

  const start = (nodeId: string, label: string | null): void => {
    setEditing(nodeId)
    setDraft(label ?? '')
  }

  const keep = (nodeId: string): void => {
    onLabel(nodeId, draft)
    setEditing(null)
    setDraft('')
  }

  if (!branches.length) {
    return (
      <EmptyState>
        No lines yet. Play a move on the board from any position to start one — what you try here is never written
        into the game.
      </EmptyState>
    )
  }

  return (
    <section className="cw-an-lines" aria-label="Your lines">
      <Segmented
        label="Order the lines"
        className="cw-an-seg"
        optionClass="cw-an-tab"
        litClass="on"
        value={order}
        options={ORDERS}
        onChange={setOrder}
      />
      <p className="cw-an-faint">
        {branches.length} line{branches.length === 1 ? '' : 's'}. Pick two to see where they end up beside each other.
      </p>

      <ul className="cw-an-ln-list">
        {/*
          * The main line is pickable too.
          *
          * It is not in the branch list -- it is not a branch -- but "where does my line end up compared with the
          * game?" is the first thing anybody asks of a variation, and leaving it out would mean only comparing two
          * side lines with each other.
          */}
        <li className={`cw-an-ln${here.includes(session.tree.rootId) ? ' is-picked' : ''}`}>
          <div className="cw-an-ln-top">
            <span className="cw-an-ln-name">The main line</span>
            <span className="cw-an-depth">
              {session.original.every((id, index) => index === 0 || session.tree.nodes[session.original[index - 1]]?.children[0] === id)
                ? 'the game as it was played'
                : 'a line you promoted; the game as played is in the list below'}
            </span>
          </div>
          <div className="cw-an-row">
            <Button size="tiny" on={here.includes(session.tree.rootId)} onClick={() => pick(session.tree.rootId)}>
              {here.indexOf(session.tree.rootId) === 0 ? 'First of two' : here.indexOf(session.tree.rootId) === 1 ? 'Second of two' : 'Compare this'}
            </Button>
          </div>
        </li>
        {branches.map((branch) => {
          const slot = here.indexOf(branch.nodeId)
          const about = [
            `${branch.length} move${branch.length === 1 ? '' : 's'}`,
            branch.notes > 0 ? `${branch.notes} note${branch.notes === 1 ? '' : 's'}` : '',
            branch.depth > 0 ? `inside another line, ${branch.depth} deep` : '',
            branch.played ? 'the game as it was played' : ''
          ].filter(Boolean).join(', ')
          return (
            <li className={`cw-an-ln${slot >= 0 ? ' is-picked' : ''}`} key={branch.nodeId}>
              <div className="cw-an-ln-top">
                <button type="button" className="cw-an-jump" onClick={() => onJump(branch.nodeId)}>
                  {branch.startsWith}
                </button>
                <span className="cw-an-ln-name">{branch.label ?? 'No name'}</span>
                <span className="cw-an-depth">{about}</span>
              </div>
              {editing === branch.nodeId ? (
                <div className="cw-an-row">
                  <input
                    className="cw-an-ln-input"
                    value={draft}
                    maxLength={STUDY_CAPS.labelChars}
                    autoFocus
                    aria-label={`A name for the line starting ${branch.startsWith}`}
                    placeholder="King-side attack"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') keep(branch.nodeId)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                  <Button size="tiny" kind="primary" onClick={() => keep(branch.nodeId)}>Keep the name</Button>
                  <Button size="tiny" onClick={() => setEditing(null)}>Leave it</Button>
                </div>
              ) : (
                <div className="cw-an-row">
                  <Button size="tiny" onClick={() => start(branch.nodeId, branch.label)}>
                    {branch.label ? 'Rename' : 'Name this line'}
                  </Button>
                  {branch.label && <Button size="tiny" onClick={() => onLabel(branch.nodeId, '')}>Take the name off</Button>}
                  <Button size="tiny" on={slot >= 0} onClick={() => pick(branch.nodeId)}>
                    {slot === 0 ? 'First of two' : slot === 1 ? 'Second of two' : 'Compare this'}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {here.length === 1 && <p className="cw-an-faint">Pick one more line to compare it with.</p>}
      {here.length === 2 && !comparison && (
        <p className="cw-an-warn">One of those lines is no longer here, so there is nothing to compare.</p>
      )}
      {comparison && <Compare comparison={comparison} orientation={orientation} onJump={onJump} />}
    </section>
  )
}
