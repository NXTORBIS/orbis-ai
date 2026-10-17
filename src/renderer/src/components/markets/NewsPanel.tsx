import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Newspaper, RefreshCw } from 'lucide-react'
import type { NewsAnswer } from '../../../../main/markets/ipc'
import type { NewsItem } from '../../../../shared/markets/news'
import type { NoticeKind } from '../../lib/notices'

/**
 * Crypto headlines.
 *
 * Every row is a real headline from a publisher's own feed, with that publisher's name on it and a link to the piece
 * itself. Orbis writes none of them, summarises none of them and rates none of them — there is no sentiment score here
 * because Orbis has no method for one it could defend.
 *
 * The two things this screen is careful to say. A publisher that could not be reached is **named**, because a quiet news
 * panel and a broken feed look identical otherwise. And a headline is only attached to a market when it actually names
 * that market — the filter will miss some genuine mentions, which is the right way round.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** How long ago, from the publisher's own timestamp. Unknown when the feed did not say. */
const ago = (at: number | null): string => {
  if (at === null) return 'date not given'
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = minutes / 60
  if (hours < 36) return `${Math.round(hours)} h ago`
  return new Date(at).toLocaleDateString()
}

export default function NewsPanel({
  onOpenMarket,
  onNotify,
  current
}: {
  onOpenMarket(instrumentId: string): void
  onNotify(message: string, kind?: NoticeKind): void
  /** The market being looked at, so its headlines can be picked out of the rest. */
  current: { symbol: string; instrumentId: string; base: string } | null
}): React.JSX.Element {
  const [state, setState] = useState<NewsAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const got = await window.api.marketsNews({ limit: 60 })
      if (refused(got)) {
        setState(null)
        onNotify(got.message ?? 'Headlines could not be read.', 'error')
        return
      }
      setState(got)
      // When the check last succeeded. Publishers' feeds are held for twenty minutes, so a Refresh inside that window
      // legitimately returns the same headlines; without this time on screen that is indistinguishable from a button
      // that did nothing at all.
      setCheckedAt(Date.now())
    } finally {
      setLoading(false)
    }
  }, [onNotify])

  useEffect(() => {
    void load()
  }, [load])

  const items: NewsItem[] = state?.items ?? []
  const shown = filter ? items.filter((one) => one.assets.includes(filter)) : items
  // Only assets that actually appear, so the filter never offers a choice that would empty the list.
  const mentioned = [...new Set(items.flatMap((one) => one.assets))].sort()

  return (
    <div className="mk-news">
      <div className="mk-replay-bar">
        <Newspaper size={14} />
        <span className="mk-quiet">
          {state ? `${items.length} headlines from ${state.sources.length} publishers` : 'Reading the feeds…'}
          {checkedAt !== null && ` · checked ${new Date(checkedAt).toLocaleTimeString()}`}
        </span>
        {mentioned.length > 0 && (
          <div className="mk-seg">
            <button type="button" className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>
              All
            </button>
            {current && mentioned.includes(current.base) && (
              <button type="button" className={filter === current.base ? 'on' : ''} onClick={() => setFilter(current.base)}>
                {current.base}
              </button>
            )}
            {mentioned
              .filter((one) => one !== current?.base)
              .slice(0, 6)
              .map((one) => (
                <button key={one} type="button" className={filter === one ? 'on' : ''} onClick={() => setFilter(one)}>
                  {one}
                </button>
              ))}
          </div>
        )}
        <button type="button" className="queue-btn small ghost" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={13} /> {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {/* A publisher that could not be reached is named. A quiet panel and a broken feed look identical otherwise. */}
      {(state?.unavailable.length ?? 0) > 0 && (
        <p className="pw-note" role="status">
          <AlertTriangle size={12} />{' '}
          {state?.unavailable.map((one) => `${one.name} could not be reached`).join('; ')}. The headlines below are from
          the publishers that answered.
        </p>
      )}

      {state?.note && <p className="pw-note">{state.note}</p>}

      {shown.length === 0 && !loading ? (
        <div className="mk-empty-small">
          <p>{filter ? `No headline mentions ${filter}.` : 'No headlines.'}</p>
          <p className="pw-note is-quiet">
            {filter
              ? 'A headline is only attached to a market when it names it, so this means none of the ones loaded did — not that nothing happened.'
              : 'Nothing came back from the feeds.'}
          </p>
        </div>
      ) : (
        <ul className="mk-headlines">
          {shown.map((one) => (
            <li key={one.id}>
              <a href={one.url} target="_blank" rel="noreferrer noopener" title={one.url}>
                {one.title}
                <ExternalLink size={11} />
              </a>
              <span className="mk-news-meta">
                <b>{one.publisher}</b>
                {one.alsoIn.length > 0 && <> · also in {one.alsoIn.join(', ')}</>}
                {' · '}
                {ago(one.publishedAt)}
              </span>
              {one.assets.length > 0 && (
                <span className="mk-news-assets">
                  {one.assets.map((asset) => (
                    <button
                      key={asset}
                      type="button"
                      onClick={() => setFilter(asset === filter ? '' : asset)}
                      title={`Only headlines naming ${asset}`}
                    >
                      {asset}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mk-quiet mk-footnote">
        Headlines come from each publisher&apos;s own syndication feed and link to the original. Orbis does not summarise
        or rate them, and a headline is linked to a market only when it names that market — so a story arriving at the
        same time as a price move is not evidence that one caused the other. Each publisher&apos;s feed is re-read at most
        every twenty minutes, so a Refresh sooner than that shows the same headlines again.
        {state && state.sources.length > 0 && (
          <> Sources: {state.sources.map((one) => one.name).join(', ')}.</>
        )}
      </p>
      {current && (
        <button type="button" className="queue-btn tiny ghost" onClick={() => onOpenMarket(current.instrumentId)}>
          Back to {current.symbol}
        </button>
      )}
    </div>
  )
}
