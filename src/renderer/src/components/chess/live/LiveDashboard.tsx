import { Button, EmptyState } from '../../../ui'
import { LiveFault } from './LiveFault'
import {
  dateRangeWords,
  delayWords,
  groupByTournament,
  providerWords,
  statusWords,
  type LiveAnswer,
  type LiveEventView,
  type TournamentGroup
} from '../../../../../shared/chess/liveView'

/**
 * What is being broadcast, as far as a provider has said.
 *
 * Everything on this screen came out of one request to one provider. Nothing is filled in around it, and the three
 * states that are easy to blur into one another are kept apart on purpose:
 *
 *   - **nothing has been asked yet** -- the screen says so and offers to ask;
 *   - **asked, and the provider says nothing is on** -- an honest empty page, which is a real answer;
 *   - **asked, and the provider could not answer** -- the provider's own reason, and what happens next.
 *
 * The third is the one that matters most: a list that failed to load and an empty list look identical if a screen
 * shows both as "nothing here", and a person then believes there is no chess on when there may be forty events.
 */

export interface LiveDashboardProps {
  /** Null before anything has been asked. */
  answer: LiveAnswer<LiveEventView[]> | null
  loading: boolean
  /** Entries that arrived and could not be read. Said out loud rather than quietly shortening the list. */
  unreadable: number
  /** Games per round, for the rounds Orbis has actually counted. A round not in here has not been counted. */
  counts: Record<string, number>
  /** Which provider was asked, so an empty page names whose emptiness it is. */
  provider: string
  onOpen: (event: LiveEventView) => void
  onRefresh: () => void
  onOpenLink: (url: string) => void
}

/** A date in the person's own locale and time zone, which is the only place that knows either. */
const asDate = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The colour of the dot beside a status. Static: nothing here animates, because nothing here is arriving. */
const DOT: Record<string, string> = { live: 'is-live', scheduled: 'is-soon', finished: 'is-over', unknown: 'is-unsure' }

function Tournament({ group, counts, onOpen, onOpenLink }: {
  group: TournamentGroup
  counts: Record<string, number>
  onOpen: (event: LiveEventView) => void
  onOpenLink: (url: string) => void
}): React.JSX.Element {
  const dates = dateRangeWords({ ...(group.from !== undefined ? { from: group.from } : {}), ...(group.to !== undefined ? { to: group.to } : {}) }, asDate)
  return (
    <li className="cw-live-tour">
      <div className="cw-live-tour-top">
        <span className={`cw-live-dot ${DOT[group.status] ?? DOT.unknown}`} aria-hidden="true" />
        <h4 className="cw-live-tour-name">{group.name}</h4>
        <span className="cw-live-pill">{statusWords(group.status)}</span>
      </div>
      <p className="cw-live-quiet">
        {/* Dates the provider did not give are not guessed at, and today's date is never one of them. */}
        {dates ?? 'Dates not given'}
        {' · '}
        {providerWords(group.provider)}
      </p>
      <ul className="cw-live-rounds">
        {group.rounds.map((round) => {
          const counted = counts[round.eventId]
          // The embargo belongs to the round that declared it. Said here, and never summed up to the tournament,
          // where it would be claimed for rounds that declared nothing.
          const delay = delayWords(round.delaySeconds)
          return (
            <li key={round.eventId}>
              <button type="button" className="cw-live-round" onClick={() => onOpen(round)}>
                <strong>{round.name}</strong>
                <small>
                  {statusWords(round.status)}
                  {round.startsAt !== undefined ? ` · starts ${asDate(round.startsAt)}` : ''}
                  {round.finishedAt !== undefined ? ` · ended ${asDate(round.finishedAt)}` : ''}
                  {/*
                   * The provider's list of what is on does not carry a game count, so one is shown only for a
                   * round Orbis has really opened and counted. "Open it to see" is the truth; a number here
                   * would have to be made up.
                   */}
                  {counted !== undefined ? ` · ${counted} game${counted === 1 ? '' : 's'}` : ' · open it to see the games'}
                </small>
                {delay && <small className="cw-live-delay">{delay}</small>}
              </button>
            </li>
          )
        })}
      </ul>
      {group.url && (
        <p className="cw-live-quiet">
          <button type="button" className="cw-live-link" onClick={() => onOpenLink(group.url as string)}>
            This tournament on {providerWords(group.provider)}
          </button>
        </p>
      )}
    </li>
  )
}

export function LiveDashboard({
  answer, loading, unreadable, counts, provider, onOpen, onRefresh, onOpenLink
}: LiveDashboardProps): React.JSX.Element {
  if (answer === null) {
    return loading
      ? <p className="cw-live-quiet" role="status">Asking {providerWords(provider)} what is being broadcast…</p>
      : (
        <EmptyState action={<Button size="small" kind="primary" onClick={onRefresh}>See what is on</Button>}>
          Orbis has not asked any provider what is being broadcast yet.
        </EmptyState>
      )
  }

  if (!answer.ok) {
    return <LiveFault fault={answer} about="The list of broadcasts" action={<Button size="small" onClick={onRefresh}>Try again</Button>} />
  }

  const groups = groupByTournament(answer.value)

  if (!groups.length) {
    return (
      <EmptyState action={<Button size="small" onClick={onRefresh} busy={loading} busyLabel="Asking…">Look again</Button>}>
        {providerWords(provider)} is not broadcasting any tournament just now. Nothing is listed here that is not
        really being carried, so this page stays empty until something is.
      </EmptyState>
    )
  }

  return (
    <div className="cw-live-dash">
      <div className="cw-live-dash-top">
        <p className="cw-live-quiet" role="status">
          {groups.length} tournament{groups.length === 1 ? '' : 's'} from {providerWords(provider)}.
          {unreadable > 0 ? ` ${unreadable} more arrived in a shape Orbis could not read and were left out.` : ''}
        </p>
        <Button size="tiny" onClick={onRefresh} busy={loading} busyLabel="Asking…">Look again</Button>
      </div>
      <ul className="cw-live-tours">
        {groups.map((group) => (
          <Tournament key={group.key} group={group} counts={counts} onOpen={onOpen} onOpenLink={onOpenLink} />
        ))}
      </ul>
    </div>
  )
}
