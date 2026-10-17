import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import {
  STATE_LABEL, engineEvidence, probeOpenings, statusesOf, summarise, withoutWords,
  type DatasetId, type DatasetStatus, type Evidence
} from '../../../../../shared/chess/reference'
import './search.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * What reference data Chess World has, honestly (Sections 187-190).
 *
 * The panel exists because of the sentence it is able to say: **"a setting points at that folder, and nothing has
 * looked there"**. Every row's state comes from a piece of evidence that names what was done to find out, and the
 * only two checks that can really be done from a window are done:
 *
 *   - the opening dataset is asked a question and the answer is read;
 *   - the engine is asked for its status, which the main process answers after stating the executable and, when it
 *     is running, after a handshake with it.
 *
 * Everything else says what it is: a dataset Orbis has no way to read, with what still works without it. Nothing
 * here guesses, and nothing here shows a tick for a file nobody opened.
 *
 * There is no event to listen to -- the chess channels are not exposed to the window as events -- so the panel
 * checks when it opens, when the person asks, and every few seconds while something is being fetched, because a
 * download is the one state that changes on its own.
 */

const RECHECK_WHILE_INSTALLING_MS = 3000

function message(error: unknown): string {
  if (!(error instanceof Error)) return 'it did not answer'
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export interface ReferencePanelProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function ReferencePanel({ onNotify }: ReferencePanelProps): React.JSX.Element {
  const [statuses, setStatuses] = useState<DatasetStatus[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const check = useCallback(async (): Promise<void> => {
    setChecking(true)
    const evidence: Partial<Record<DatasetId, Evidence>> = { openings: probeOpenings() }
    try {
      // The only real check of the engine there is: the main process stats the executable and, when it is running,
      // has completed a handshake with it. Read as an unknown shape, because this window's declared type for it is
      // narrower than what really arrives.
      const status: unknown = await window.api.chessEngineStatus()
      evidence.engine = engineEvidence(status)
    } catch (error) {
      evidence.engine = { kind: 'no-way-to-look', why: `Asking the engine did not work: ${message(error)}.` }
    }
    if (!alive.current) return
    setStatuses(statusesOf(evidence))
    setChecking(false)
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  // A download is the one thing that finishes without anybody pressing anything, so that is the one thing worth
  // looking at again on a timer.
  const busyInstalling = statuses?.some((one) => one.state === 'installing') ?? false
  useEffect(() => {
    if (!busyInstalling) return
    const timer = setInterval(() => void check(), RECHECK_WHILE_INSTALLING_MS)
    return () => clearInterval(timer)
  }, [busyInstalling, check])

  const install = async (status: DatasetStatus): Promise<void> => {
    setInstalling(true)
    try {
      await window.api.chessEngineInstall()
      onNotify?.(`Setting up ${status.dataset.name.toLowerCase()}. This panel will keep checking.`)
      await check()
    } catch (error) {
      onNotify?.(`That did not work: ${message(error)}.`, 'error')
    } finally {
      setInstalling(false)
    }
  }

  const summary = statuses ? summarise(statuses) : null

  /*
   * What Orbis itself may do here: ask again what is really on this computer.
   *
   * Fetching a dataset is not offered. It is a download of hundreds of megabytes under its own licence, and that is
   * a decision for the person in front of the screen rather than for an assistant.
   */
  useSurface(
    simpleAreaSurface({
      id: 'reference',
      name: 'Reference data',
      about: 'Which datasets are really on this computer. Fetching one is left to the person; Orbis can only look.',
      keywords: ['reference', 'datasets', 'data', 'tablebase', 'opening book', 'installed'],
      state: () => ({
        // Null before anything has been asked, rather than nought datasets which would read as "none installed".
        datasets: statuses === null ? null : statuses.length,
        here: statuses === null ? null : statuses.filter((one) => one.state === 'present').length,
        checking,
        installing
      })
    })
  )

  return (
    <section className="cw-search-ref" aria-label="Reference data">
      <header className="cw-search-ref-top">
        <h3 className="cw-search-heading">Reference data</h3>
        <Button size="tiny" busy={checking} busyLabel="Checking…" onClick={() => void check()}>
          Check again
        </Button>
      </header>
      <p className="cw-search-faint" role="status">
        {summary ? summary.words : 'Checking what is here…'}
      </p>
      <p className="cw-search-faint">
        Every line below says what was actually done to find out. A setting that names a folder is shown as a
        setting, never as a dataset that is here.
      </p>

      <ul className="cw-search-ref-list">
        {(statuses ?? []).map((status) => {
          const d = status.dataset
          const lost = withoutWords(status)
          return (
            <li key={d.id} className="cw-search-ref-item">
              <div className="cw-search-ref-head">
                <strong>{d.name}</strong>
                <span className="cw-search-ref-state" data-state={status.state}>{STATE_LABEL[status.state]}</span>
                {status.fault ? <span className="cw-search-ref-fault">Something is wrong</span> : null}
              </div>
              <p className="cw-search-ref-says">{status.says}</p>
              <p className="cw-search-faint">{d.purpose}</p>

              <dl className="cw-search-ref-facts">
                <div>
                  <dt>Source</dt>
                  <dd>
                    {d.source.name}
                    {d.source.url ? <><br /><span className="cw-search-url">{d.source.url}</span></> : null}
                  </dd>
                </div>
                <div>
                  <dt>Licence</dt>
                  <dd>{d.licence ? `${d.licence.name} (${d.licence.id})` : 'Not known here: it depends which copy you have.'}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{status.version ?? 'Not known. Nothing has read a version.'}</dd>
                </div>
                <div>
                  <dt>Where</dt>
                  <dd>{status.location ?? d.whereWords}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{status.size ? status.size.words : 'Not measured.'}</dd>
                </div>
                <div>
                  <dt>How it is checked</dt>
                  <dd>{status.checkedBy}</dd>
                </div>
              </dl>

              {lost.length > 0 && (
                <div className="cw-search-ref-without">
                  <p className="cw-search-faint">What still works without it:</p>
                  <ul>
                    {lost.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              )}

              {d.notes.map((note) => <p key={note} className="cw-search-faint">{note}</p>)}

              {d.install.can && (status.state === 'absent' || status.state === 'broken') && (
                <Button size="small" kind="primary" busy={installing} busyLabel="Asking…" onClick={() => void install(status)}>
                  Set it up now
                </Button>
              )}
              {!d.install.can && status.state !== 'present' && (
                <p className="cw-search-faint">{d.install.how}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ReferencePanel
