import { useCallback, useEffect, useState } from 'react'
import type { RecallOverview } from '../../../main/knowledge/recallIpc'
import { RECALL_LIMITS } from '../../../shared/recall'

/**
 * Whether Orbis keeps the text of the pages you read, and what it is holding.
 *
 * The switch is here rather than in the browser, deliberately. Searching what you have read belongs in the browser,
 * because everything in it came from browsing — but *deciding to record it at all* is a decision that needs the whole
 * sentence in front of you, including the part about the file not being encrypted, and a panel beside a search box is
 * not where somebody reads that.
 *
 * The one thing this screen must not do is sell the feature. It says what is kept, what is never kept, what it costs,
 * and where the text sits. Somebody who reads that and leaves it off has been served properly.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

export default function RecallSettings(): React.JSX.Element | null {
  const [overview, setOverview] = useState<RecallOverview | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const answer = await window.api.recallOverview()
    if (!refused(answer)) setOverview(answer)
  }, [])

  useEffect(() => {
    void load()
    return window.api.onRecallChanged(() => void load())
  }, [load])

  const change = async (next: Parameters<typeof window.api.recallSetSettings>[0]): Promise<void> => {
    setBusy(true)
    try {
      const answer = await window.api.recallSetSettings(next)
      if (!refused(answer)) setOverview(answer)
    } finally {
      setBusy(false)
    }
  }

  if (!overview) return null
  const on = overview.settings.enabled

  return (
    <section className="setting">
      <div className="setting-label">
        <h3>Pages you have read</h3>
        <p>
          Keep the text of pages you read, so you can find them again by what was in them — and so Orion can answer
          “what was that article about…” from what you actually read. Search it in the browser, under Pages you have
          read.
        </p>
      </div>

      <div className="pw-panel">
        <ul className="rs-promises">
          <li>It stays on this computer. Nothing is uploaded, and there is no account.</li>
          <li>Text only. Orbis never takes a picture of your screen.</li>
          <li>Private tabs are never read, and neither are sign-in or payment pages.</li>
          <li>A page is kept only after you have had it open and in front of you for a few seconds.</li>
          <li>Switching it off again deletes everything it kept.</li>
        </ul>

        {/*
          The sentence somebody is entitled to before deciding, in the place they decide. Searching needs the text, so
          the text is on the disk in readable form; there is no version of this feature where that is not true.
        */}
        <p className="rs-caution">
          The file is <b>not encrypted</b>. Searching needs the text, so it sits on your disk in readable form —
          anything that can read your files can read it. If that is not a trade you want, leave this off.
        </p>

        <label className="tl-switch">
          <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void change({ enabled: e.target.checked })} />
          <span>Keep the pages I read</span>
        </label>

        {on && (
          <>
            <p className="pw-state">
              <span>
                {overview.pages.toLocaleString()} page{overview.pages === 1 ? '' : 's'}, about {overview.size}
                {overview.oldestAt ? `, going back to ${new Date(overview.oldestAt).toLocaleDateString()}` : ''}.
              </span>
            </p>

            <label className="tl-delay">
              <span>Forget after</span>
              <select
                value={String(overview.settings.keepDays)}
                disabled={busy}
                onChange={(e) => void change({ keepDays: Number(e.target.value) })}
              >
                <option value="7">A week</option>
                <option value="30">A month</option>
                <option value="90">Three months</option>
                <option value="365">A year</option>
                <option value={String(RECALL_LIMITS.keepDays.min)}>Never</option>
              </select>
            </label>

            <label className="tl-delay">
              <span>Keep at most</span>
              <select
                value={String(overview.settings.maxPages)}
                disabled={busy}
                onChange={(e) => void change({ maxPages: Number(e.target.value) })}
              >
                <option value="1000">1,000 pages</option>
                <option value="5000">5,000 pages</option>
                <option value="20000">20,000 pages</option>
                <option value="100000">100,000 pages</option>
              </select>
            </label>

            <label className="tl-switch">
              <input
                type="checkbox"
                checked={overview.settings.skipPrivate}
                disabled={busy}
                onChange={(e) => void change({ skipPrivate: e.target.checked })}
              />
              <span>Never read private tabs</span>
            </label>

            {overview.topHosts.length > 0 && (
              <p className="pw-note is-quiet">
                Most from: {overview.topHosts.slice(0, 4).map((one) => `${one.host} (${one.pages})`).join(', ')}. Forget
                a single page or a whole site from the browser panel.
              </p>
            )}

            {/* Deleting everything is one press and one confirmation, never buried. */}
            <button
              type="button"
              className="queue-btn"
              disabled={busy || overview.pages === 0}
              onClick={() => {
                if (!window.confirm(`Forget all ${overview.pages.toLocaleString()} pages? This cannot be undone.`)) return
                void window.api.recallClear().then(() => void load())
              }}
            >
              Forget everything
            </button>
          </>
        )}
      </div>
    </section>
  )
}
