import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, FileArchive, Info, Upload, X } from 'lucide-react'
import type {
  PortableEstimate,
  PortableExportResult,
  PortableImportResult,
  PortableInspection,
  PortableProgress,
  PortableRecovery,
  PortableTransferState
} from '../../../shared/types'
import { judgePassword } from '../../../shared/passwordStrength'

/**
 * Moving a whole Orbis profile to another machine, in Settings.
 *
 * Two halves that meet in the middle: writing a package out, and reading one back. Both are built around showing what
 * will happen before it happens, because this is the one feature where somebody may delete the original afterwards.
 *
 * ## Nothing here decides anything
 *
 * Which categories exist, which cannot travel, whether a selection needs a password, how much room it needs, and what
 * has to be re-entered afterwards all come from the main process. This screen asks, shows what came back, and keeps
 * nothing — the password fields are cleared the moment they have been used.
 *
 * ## What is shown and never hidden behind a disclosure
 *
 * The things that cannot travel, with the reason for each. A package that quietly omits the saved browser passwords
 * and says "Everything exported" is how somebody loses them, so the exclusions sit next to the button rather than
 * behind it.
 */

type Busy = '' | 'estimating' | 'exporting' | 'inspecting' | 'importing'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const said = (value: unknown): { error: string; message?: string } | null =>
  typeof value === 'object' && value !== null && 'error' in value ? (value as { error: string; message?: string }) : null

export default function TransferSettings({ userName }: { userName: string }): React.JSX.Element {
  const [state, setState] = useState<PortableTransferState | null>(null)
  const [busy, setBusy] = useState<Busy>('')
  const [problem, setProblem] = useState('')
  const [progress, setProgress] = useState<PortableProgress | null>(null)
  const [recovery, setRecovery] = useState<PortableRecovery | null>(null)

  // Exporting
  const [chosen, setChosen] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [estimate, setEstimate] = useState<PortableEstimate | null>(null)
  const [exported, setExported] = useState<PortableExportResult | null>(null)

  // Importing
  const [packagePath, setPackagePath] = useState('')
  const [inspection, setInspection] = useState<PortableInspection | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('merge')
  const [imported, setImported] = useState<PortableImportResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.portableState().then((answer) => {
      if (!alive) return
      const problem = said(answer)
      if (problem !== null) {
        setProblem(problem.message ?? 'The transfer settings could not be read.')
        return
      }
      const value = answer as PortableTransferState
      setState(value)
      // Everything that can travel, selected. The exclusions are shown separately and are never silently included.
      setChosen(value.everything)
    })
    void window.api.portableRecovery().then((answer) => {
      if (!alive) return
      if (said(answer) === null) setRecovery(answer as PortableRecovery)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => window.api.onPortableProgress((one) => setProgress(one)), [])

  const carriable = useMemo(() => (state?.categories ?? []).filter((one) => one.canTravel), [state])
  const selected = useMemo(() => carriable.filter((one) => chosen.includes(one.id)), [carriable, chosen])
  const needsPassword = useMemo(() => selected.some((one) => one.sensitivity === 'personal'), [selected])
  const verdict = useMemo(() => (password === '' ? null : judgePassword(password, userName)), [password, userName])
  const passwordsMatch = password !== '' && password === again

  const toggle = useCallback((id: string) => {
    setChosen((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]))
    setEstimate(null)
    setExported(null)
  }, [])

  const runExport = useCallback(async () => {
    setProblem('')
    setExported(null)
    const destination = await window.api.portableChooseDestination({ name: `orbis-${userName || 'profile'}` })
    if (destination.path === null) return
    setBusy('exporting')
    try {
      const answer = await window.api.portableExport({
        profileName: userName,
        categoryIds: chosen,
        purpose: 'transfer',
        password: needsPassword || password !== '' ? password : null,
        destination: destination.path
      })
      const problem = said(answer)
      if (problem !== null) {
        setProblem(problem.message ?? 'The export did not work.')
        return
      }
      setExported(answer as PortableExportResult)
    } finally {
      setBusy('')
      setProgress(null)
      // Used and gone. Nothing here keeps a package password.
      setPassword('')
      setAgain('')
    }
  }, [chosen, needsPassword, password, userName])

  const look = useCallback(async (path: string) => {
    setProblem('')
    setInspection(null)
    setImported(null)
    setPackagePath(path)
    setBusy('inspecting')
    try {
      const answer = await window.api.portableInspect({ path })
      const problem = said(answer)
      if (problem !== null) {
        setProblem(problem.message ?? 'That package could not be read.')
        return
      }
      setInspection(answer as PortableInspection)
    } finally {
      setBusy('')
    }
  }, [])

  const pickPackage = useCallback(async () => {
    const picked = await window.api.portableChoosePackage()
    if (picked.path !== null) await look(picked.path)
  }, [look])

  const runImport = useCallback(async () => {
    if (inspection === null) return
    setProblem('')
    setBusy('importing')
    try {
      const answer = await window.api.portableImport({
        path: packagePath,
        categoryIds: inspection.compatibility.willRestore,
        mode,
        password: importPassword === '' ? null : importPassword
      })
      const problem = said(answer)
      if (problem !== null) {
        const rolled = (answer as { rolledBack?: boolean | null }).rolledBack
        setProblem(
          `${problem.message ?? 'The import did not work.'}${rolled === true ? '' : rolled === false ? ' The profile could not be put back automatically.' : ''}`
        )
        return
      }
      setImported(answer as PortableImportResult)
    } finally {
      setBusy('')
      setProgress(null)
      setImportPassword('')
    }
  }, [importPassword, inspection, mode, packagePath])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer.files[0]
      // Electron puts the real path on the File; without it there is nothing to read and saying so beats a blank pane.
      const path = file === undefined ? '' : window.api.pathForFile(file)
      if (path === '') {
        setProblem('That file could not be located on disk. Use the button to choose it instead.')
        return
      }
      void look(path)
    },
    [look]
  )

  if (state === null) {
    return (
      <section className="setting transfer">
        <div className="setting-label">
          <h3>Transfer Orbis</h3>
          <p>{problem === '' ? 'Reading what this profile is made of…' : problem}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="setting transfer">
      <div className="setting-label">
        <h3>Transfer Orbis</h3>
        <p>
          Write this profile to a single file and open it on another machine. Everything is checked before it is
          written and checked again before it is read back, and nothing in a package is ever run.
        </p>
      </div>

      {recovery?.interrupted === true && (
        <div className="transfer-alert" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <div>
            <strong>An earlier import did not finish.</strong>
            <p>{recovery.why}</p>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                void window.api.portableRecoveryClear().then(() => setRecovery(null))
              }}
            >
              I have checked those
            </button>
          </div>
        </div>
      )}

      {problem !== '' && (
        <p className="transfer-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      {/* ---------------------------------------------------------------- out */}
      <div className="transfer-half">
        <h4>
          <Download size={14} aria-hidden /> Take this profile with you
        </h4>

        <div className="transfer-categories" role="group" aria-label="What to include">
          {carriable.map((one) => (
            <label key={one.id} className="transfer-category">
              <input type="checkbox" checked={chosen.includes(one.id)} onChange={() => toggle(one.id)} />
              <span>
                <strong>{one.label}</strong>
                <em>{one.describe}</em>
                {one.requiresReauthentication && one.userAction !== null && <i>Afterwards: {one.userAction}</i>}
              </span>
            </label>
          ))}
        </div>

        {state.excluded.length > 0 && (
          <div className="transfer-excluded">
            <h5>
              <Info size={13} aria-hidden /> These cannot travel, and are not in any package
            </h5>
            <ul>
              {state.excluded.map((one) => (
                <li key={one.id}>
                  <strong>{one.label}</strong> — {one.why}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="transfer-password">
          <label>
            <span>Package password{needsPassword ? '' : ' (optional)'}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            <span>Again</span>
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        {needsPassword && password === '' && (
          <p className="transfer-note">
            Some of what you chose is your own content. A package without a password is a plain file that anyone who
            picks up the drive can read.
          </p>
        )}
        {verdict !== null && !verdict.ok && <p className="transfer-problem">{verdict.problem}</p>}
        {password !== '' && again !== '' && !passwordsMatch && <p className="transfer-problem">Those two do not match.</p>}
        <ul className="transfer-note-list">
          {state.protectionNotes.map((one) => (
            <li key={one}>{one}</li>
          ))}
        </ul>

        <div className="transfer-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== '' || selected.length === 0}
            onClick={() => {
              setBusy('estimating')
              void window.api
                .portableEstimate({ profileName: userName, categoryIds: chosen, destination: '' })
                .then((answer) => {
                  const problem = said(answer)
                  if (problem !== null) setProblem(problem.message ?? 'That could not be worked out.')
                  else setEstimate(answer as PortableEstimate)
                })
                .finally(() => setBusy(''))
            }}
          >
            How big will it be?
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== '' || selected.length === 0 || (password !== '' && (!passwordsMatch || verdict?.ok !== true)) || (needsPassword && password === '')}
            onClick={() => void runExport()}
          >
            {busy === 'exporting' ? 'Writing…' : `Export ${selected.length} ${selected.length === 1 ? 'thing' : 'things'}`}
          </button>
          {busy === 'exporting' && (
            <button type="button" className="ghost-btn" onClick={() => void window.api.portableCancel()}>
              Stop
            </button>
          )}
        </div>

        {estimate !== null && <p className="transfer-note">{estimate.why}</p>}

        {exported !== null && (
          <div className={exported.complete.complete ? 'transfer-done' : 'transfer-alert'} role="status">
            {exported.complete.complete ? <Check size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
            <div>
              <strong>
                {exported.complete.complete ? 'Written' : 'Written, but not complete'} — {formatBytes(exported.bytes)}
              </strong>
              <p>{exported.destination}</p>
              <p>{exported.complete.describe}</p>
              {exported.failures.map((one) => (
                <p key={one.categoryId} className="transfer-problem">
                  {one.categoryId}: {one.message}
                </p>
              ))}
              {exported.notes.map((one) => (
                <p key={one}>{one}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- in */}
      <div className="transfer-half">
        <h4>
          <Upload size={14} aria-hidden /> Bring a profile here
        </h4>

        <div
          ref={dropRef}
          className={dragging ? 'transfer-drop over' : 'transfer-drop'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <FileArchive size={18} aria-hidden />
          <p>Drop a .orbis package here, or</p>
          <button type="button" className="ghost-btn" disabled={busy !== ''} onClick={() => void pickPackage()}>
            Choose a file
          </button>
        </div>

        {inspection !== null && (
          <div className="transfer-inspection">
            <h5>
              {inspection.manifest.profileName} — {formatBytes(inspection.sizeBytes)}
              {inspection.encrypted ? ' · encrypted' : ' · not encrypted'}
            </h5>
            <p>{inspection.compatibility.describe}</p>

            {inspection.blocking.length > 0 ? (
              <div className="transfer-alert" role="alert">
                <AlertTriangle size={14} aria-hidden />
                <div>
                  <strong>This package cannot be opened by this version of Orbis.</strong>
                  {inspection.blocking.map((one) => (
                    <p key={one}>{one}</p>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {inspection.compatibility.cannotUse.length > 0 && (
                  <div className="transfer-excluded">
                    <h5>
                      <Info size={13} aria-hidden /> Parts of it will be left alone
                    </h5>
                    <ul>
                      {inspection.compatibility.cannotUse.map((one) => (
                        <li key={one.id}>
                          <strong>{one.id}</strong> — {one.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {inspection.encrypted && (
                  <label className="transfer-single">
                    <span>The package password</span>
                    <input
                      type="password"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                )}

                <div className="transfer-mode" role="radiogroup" aria-label="How to bring it in">
                  <label>
                    <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                    <span>
                      <strong>Add to what is here</strong>
                      <em>Anything already in this profile is kept as it is. Only what is new comes across.</em>
                    </span>
                  </label>
                  <label>
                    <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                    <span>
                      <strong>Replace what is here</strong>
                      <em>The package's version wins for everything it carries. What it does not carry is untouched.</em>
                    </span>
                  </label>
                </div>

                <div className="transfer-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={busy !== '' || (inspection.encrypted && importPassword === '')}
                    onClick={() => void runImport()}
                  >
                    {busy === 'importing' ? 'Bringing it in…' : 'Import'}
                  </button>
                  {busy === 'importing' && (
                    <button type="button" className="ghost-btn" onClick={() => void window.api.portableCancel()}>
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy !== ''}
                    onClick={() => {
                      setInspection(null)
                      setPackagePath('')
                      setImported(null)
                    }}
                  >
                    <X size={13} aria-hidden /> Forget this file
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {imported !== null && (
          <div className="transfer-done" role="status">
            <Check size={14} aria-hidden />
            <div>
              <strong>
                {imported.filesWritten} file{imported.filesWritten === 1 ? '' : 's'} written
              </strong>
              {imported.categories
                .filter((one) => one.status !== 'applied' || one.notes.length > 0)
                .map((one) => (
                  <p key={one.categoryId}>
                    <strong>{one.categoryId}</strong> — {one.status}. {one.notes.join(' ')}
                  </p>
                ))}
              {imported.actionsAfterImport.length > 0 && (
                <>
                  <strong>What you need to do now</strong>
                  <ul>
                    {imported.actionsAfterImport.map((one) => (
                      <li key={one.id}>
                        <strong>{one.label}</strong> — {one.action}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {imported.notes.map((one) => (
                <p key={one}>{one}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {progress !== null && busy !== '' && (
        <p className="transfer-progress" role="status">
          {progress.message}
          {progress.filesTotal !== undefined && progress.filesTotal > 0 && ` (${progress.filesDone ?? 0} of ${progress.filesTotal})`}
        </p>
      )}
    </section>
  )
}
