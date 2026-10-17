import { FileDown, Microscope, Star, Trash } from 'lucide-react'
import { Button } from '../../../ui'
import { OUTCOME_WORDS, type ArchiveRow } from '../../../../../shared/chess/archive'
import { collectionsOf, plainTags, resultWords, sourceWords } from '../../../../../shared/chess/library'

/**
 * The game the board is showing: what the record says about it, and the things you can do with it.
 *
 * Facts, not prose. Every line is a label and something read off the game, and a line is left out when the record
 * does not carry it -- there is no row saying "Event: unknown", because that is not a fact about the game.
 */

export interface GameCardProps {
  row: ArchiveRow
  /** Open it in the analysis board, at the move the board is on. */
  onOpen: (ply: number) => void
  /** Open it in Game Review, when Chess World really offers that screen. Left out, no button is drawn. */
  onReview?: () => void
  ply: number
  onStar: (favourite: boolean) => void
  onExport: () => void
  onRemove: () => void
  busy?: boolean
}

export function GameCard({ row, onOpen, onReview, ply, onStar, onExport, onRemove, busy = false }: GameCardProps): React.JSX.Element {
  const meta = row.game.meta
  const facts: { label: string; value: string }[] = []
  if (row.side !== null) facts.push({ label: 'You were', value: row.side === 'w' ? 'White' : 'Black' })
  if (row.side !== null) facts.push({ label: 'Result', value: `${OUTCOME_WORDS[row.outcome]} (${resultWords(meta.result)})` })
  else facts.push({ label: 'Result', value: resultWords(meta.result) })
  if (row.opponent) facts.push({ label: 'Opponent', value: row.opponentRating === null ? row.opponent : `${row.opponent} (${row.opponentRating})` })
  if (row.date.text) facts.push({ label: 'Date', value: row.date.text })
  if (meta.event) facts.push({ label: 'Event', value: meta.event })
  if (meta.site) facts.push({ label: 'Place', value: meta.site })
  if (meta.round) facts.push({ label: 'Round', value: meta.round })
  if (meta.timeControl) facts.push({ label: 'Time', value: meta.timeControl })
  if (row.opening) {
    facts.push({
      label: 'Opening',
      value: `${row.opening.eco ? `${row.opening.eco} ` : ''}${row.opening.name}${row.opening.from === 'dataset' ? ' (named by position)' : ''}`
    })
  }
  if (row.ended) facts.push({ label: 'How it ended', value: row.ended })
  facts.push({ label: 'Moves', value: String(row.moves) })
  if (row.game.variant !== 'standard') facts.push({ label: 'Variant', value: row.game.variant })
  facts.push({ label: 'Where from', value: sourceWords(row.game.source.kind) })

  const tags = plainTags(row.game)
  const collections = collectionsOf(row.game)

  return (
    <div className="cw-lb-card cw-lb-gamecard">
      <h3 className="cw-lb-card-title">
        {meta.white.name ?? 'Unnamed'} <span className="cw-lb-faint">vs</span> {meta.black.name ?? 'Unnamed'}
      </h3>
      <dl className="cw-lb-facts2">
        {facts.map((one) => (
          <div key={one.label}>
            <dt>{one.label}</dt>
            <dd>{one.value}</dd>
          </div>
        ))}
      </dl>
      {(tags.length > 0 || collections.length > 0) && (
        <ul className="cw-lb-taglist">
          {collections.map((one) => <li key={`c${one}`} className="is-collection">{one}</li>)}
          {tags.map((one) => <li key={`t${one}`}>{one}</li>)}
        </ul>
      )}
      <div className="cw-lb-cardbtns">
        <Button size="tiny" kind="primary" icon={<Microscope size={13} aria-hidden="true" />} onClick={() => onOpen(ply)}>
          Open on the analysis board
        </Button>
        {onReview && <Button size="tiny" onClick={onReview}>Open the report</Button>}
        <Button size="tiny" icon={<FileDown size={13} aria-hidden="true" />} disabled={busy} onClick={onExport}>Save as PGN</Button>
        <Button
          size="tiny"
          on={row.game.favourite === true}
          icon={<Star size={13} aria-hidden="true" />}
          disabled={busy}
          onClick={() => onStar(row.game.favourite !== true)}
        >
          {row.game.favourite ? 'Starred' : 'Star'}
        </Button>
        <Button size="tiny" kind="danger" icon={<Trash size={13} aria-hidden="true" />} disabled={busy} onClick={onRemove}>Remove</Button>
      </div>
      {/* Said out loud, because the button above opens the board at the move you are looking at and not at the start. */}
      <p className="cw-lb-about">The analysis board opens at the move the board is showing.</p>
    </div>
  )
}

export default GameCard
