import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts } from './LabShell'
import './phase9.css'

/**
 * The Code Playground: write a program in any of twenty languages, give it input, and run it.
 *
 * ## It never pretends a guess is a run
 *
 * Two things can produce the output on this screen. A sandbox somewhere else really compiles and runs the code,
 * or Orion reads it and says what it thinks would happen. Those look identical as text and are not remotely the
 * same, so the result carries where it came from and this shows it prominently — and a predicted result has no
 * running time and no memory figure, because nothing ran.
 *
 * ## The input box is connected to something
 *
 * Every starter program reads a line. That is deliberate: a playground where the input box does nothing teaches
 * that input is decoration, and the single most common thing a beginner's program needs to do is read something.
 *
 * ## Nothing runs on this machine
 *
 * Not in a subprocess, not in a worker, not in an iframe. It goes to a remote sandbox or it goes to a model that
 * reads it. There is no third route and there is not meant to be.
 */

interface LanguageRow {
  id: string
  name: string
  category: string
  extension: string
  syntax: string
  canReallyRun: boolean
}

type Verdict = 'ok' | 'wrong-output' | 'compile-error' | 'runtime-error' | 'timeout' | 'memory' | 'provider-error'

interface RunResult {
  language: string
  origin: 'ran' | 'predicted'
  verdict: Verdict
  stdout: string
  stderr: string
  compileOutput: string
  seconds: number | null
  memoryKb: number | null
  exitCode: number | null
  /** Said above the output, and it carries the reason when this is a prediction. */
  says: string
  notes: string[]
}

/** The engine's own words for each verdict, so the screen and the engine cannot drift apart. */
const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  ok: 'ran to the end',
  'wrong-output': 'ran, and the output did not match what was expected',
  'compile-error': 'would not compile',
  'runtime-error': 'started and then failed',
  timeout: 'took too long and was stopped',
  memory: 'used more memory than it was allowed',
  'provider-error': 'the runner itself failed'
}

interface Refusal {
  error: string
  message: string
  fix: string
}

const isRefusal = (value: unknown): value is Refusal =>
  typeof value === 'object' && value !== null && 'error' in value && 'fix' in value

export default function CodePlaygroundLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const [languages, setLanguages] = useState<LanguageRow[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [ready, setReady] = useState<{ sandbox: boolean; orion: boolean; says: string } | null>(null)
  const [language, setLanguage] = useState('python')
  const [source, setSource] = useState('')
  const [stdin, setStdin] = useState('')
  const [result, setResult] = useState<RunResult | null>(null)
  const [refused, setRefused] = useState<Refusal | null>(null)
  const [busy, setBusy] = useState(false)
  const [showing, setShowing] = useState('output')
  const [broke, setBroke] = useState<string | null>(null)
  // Which language the source in the box belongs to, so switching does not quietly replace work.
  const sourceFor = useRef<string>('')
  const edited = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [list, state] = await Promise.all([window.api.executionLanguages(), window.api.executionReady()])
        if (!alive) return
        setLanguages(list.languages as LanguageRow[])
        setNotes(list.notes)
        setReady(state)
      } catch (error) {
        if (alive) setBroke(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Load the starter for a language — but never over something that has been typed into.
  useEffect(() => {
    let alive = true
    if (edited.current && sourceFor.current !== '' && sourceFor.current !== language) return
    void (async () => {
      try {
        const starter = await window.api.executionStarter(language)
        if (!alive) return
        setSource(starter)
        sourceFor.current = language
        edited.current = false
      } catch {
        // A missing starter is not worth an error on screen; an empty editor is a usable editor.
      }
    })()
    return () => {
      alive = false
    }
  }, [language])

  const current = useMemo(() => languages.find((one) => one.id === language) ?? null, [languages, language])

  const run = useCallback(
    async (predictOnly: boolean) => {
      setBusy(true)
      setRefused(null)
      setBroke(null)
      try {
        const got = await window.api.runCode({ language, source, stdin, predictOnly })
        if (isRefusal(got)) {
          setRefused(got)
          setResult(null)
        } else {
          setResult(got as RunResult)
          setShowing('output')
        }
      } catch (error) {
        setBroke(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [language, source, stdin]
  )

  const byCategory = useMemo(() => {
    const groups = new Map<string, LanguageRow[]>()
    for (const one of languages) {
      const held = groups.get(one.category)
      if (held) held.push(one)
      else groups.set(one.category, [one])
    }
    return [...groups.entries()]
  }, [languages])

  const lineCount = source.split('\n').length

  return (
    <LabShell
      title="Code Playground"
      summary={
        result
          ? `${VERDICT_WORDS[result.verdict]} — ${result.origin === 'ran' ? 'really ran' : 'Orion read it'}`
          : (ready?.says ?? undefined)
      }
      refused={refused ? { says: refused.message, fix: refused.fix } : null}
      broke={broke}
      busy={busy}
      waitingFor={ready?.sandbox === true ? 'Compiling and running…' : 'Asking Orion to read it…'}
      ready={languages.length > 0}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'output', label: 'What it printed' },
        { id: 'code', label: 'The program' },
        { id: 'languages', label: 'Languages' },
        { id: 'about', label: 'How this works' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        result !== null ? (
          <>
            <Facts
              title={result.origin === 'ran' ? 'It ran' : 'Orion read it'}
              rows={[
                ['Result', VERDICT_WORDS[result.verdict]],
                // Both null for a prediction, and shown as such rather than as a zero.
                ['Took', result.seconds === null ? 'not measured — nothing ran' : `${result.seconds.toFixed(3)} s`],
                ['Memory', result.memoryKb === null ? 'not measured — nothing ran' : `${(result.memoryKb / 1024).toFixed(1)} MB`],
                ['Exit code', result.exitCode === null ? '—' : String(result.exitCode)]
              ]}
              about={
                result.origin === 'predicted'
                  ? result.says
                  : 'Compiled and executed in a sandbox. This is what the program actually printed.'
              }
            />
          </>
        ) : null
      }
    >
      <div className="p9-bar">
        <label className="p9-pick">
          <span>Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {byCategory.map(([category, rows]) => (
              <optgroup key={category} label={category}>
                {rows.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                    {one.canReallyRun ? '' : ' (predicted only)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <button type="button" className="p9-run" disabled={busy || source.trim() === ''} onClick={() => void run(false)}>
          {busy ? 'Working…' : ready?.sandbox === true ? 'Run it' : 'Ask Orion'}
        </button>
        {/* Deliberately separate, so the two can be compared on purpose rather than by accident. */}
        <button type="button" className="p9-predict" disabled={busy || source.trim() === ''} onClick={() => void run(true)} title="Ask Orion what it thinks this would print, without running it">
          Predict instead
        </button>
      </div>

      {ready !== null && (
        <p className={`p9-where${ready.sandbox ? ' real' : ''}`}>
          {ready.sandbox ? '●' : '○'} {ready.says}
        </p>
      )}

      {showing === 'output' && (
        <>
          {result === null ? (
            <p className="p4-says">Nothing has been run yet. Write something and press {ready?.sandbox === true ? 'Run it' : 'Ask Orion'}.</p>
          ) : (
            <>
              {/* The origin is the first thing on the screen, not a footnote. */}
              <div className={`p9-origin ${result.origin}`}>
                <strong>
                  {result.origin === 'ran'
                    ? 'This really ran. The output below is what the program printed.'
                    : result.says}
                </strong>
                {/* The engine puts the reason it fell back in the first note — which sandbox failed, and how. That
                    is the one thing somebody needs to fix the situation, so it goes on screen rather than staying
                    in a field nothing reads. */}
                {result.origin === 'predicted' && result.notes.length > 0 && (
                  <ul className="p9-why">
                    {result.notes.map((one) => (
                      <li key={one}>{one}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={`p9-verdict ${result.verdict}`}>{VERDICT_WORDS[result.verdict]}</div>

              {result.compileOutput.trim() !== '' && (
                <>
                  <h4 className="p4-heading">It would not compile</h4>
                  <pre className="p9-stream error">{result.compileOutput}</pre>
                </>
              )}
              {result.stdout.trim() !== '' && (
                <>
                  <h4 className="p4-heading">Output</h4>
                  <pre className="p9-stream">{result.stdout}</pre>
                </>
              )}
              {result.stderr.trim() !== '' && (
                <>
                  <h4 className="p4-heading">Errors</h4>
                  <pre className="p9-stream error">{result.stderr}</pre>
                </>
              )}
              {result.stdout.trim() === '' && result.stderr.trim() === '' && result.compileOutput.trim() === '' && (
                <p className="p4-says">It ran and printed nothing at all.</p>
              )}
            </>
          )}
        </>
      )}

      {showing === 'code' && (
        <div className="p9-editor">
          <div className="p9-editor-head">
            <span>
              {current?.name ?? language}
              <code>.{current?.extension ?? 'txt'}</code>
            </span>
            <span className="p2-faint">{lineCount} line{lineCount === 1 ? '' : 's'}</span>
          </div>
          <div className="p9-code">
            {/* The gutter is a sibling, not a background image: it has to line up with wrapped text, and a
                background would drift the moment a line wraps. */}
            <div className="p9-gutter" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, one) => (
                <span key={one}>{one + 1}</span>
              ))}
            </div>
            <textarea
              className="p9-source"
              value={source}
              spellCheck={false}
              aria-label={`${current?.name ?? language} source`}
              onChange={(event) => {
                setSource(event.target.value)
                edited.current = true
                sourceFor.current = language
              }}
              onKeyDown={(event) => {
                // Tab inserts a tab rather than leaving the box. In a code editor that is what it is for.
                if (event.key !== 'Tab' || event.shiftKey) return
                event.preventDefault()
                const box = event.currentTarget
                const at = box.selectionStart
                const next = `${source.slice(0, at)}  ${source.slice(box.selectionEnd)}`
                setSource(next)
                edited.current = true
                requestAnimationFrame(() => {
                  box.selectionStart = at + 2
                  box.selectionEnd = at + 2
                })
              }}
            />
          </div>

          <label className="p9-stdin">
            <span>
              Input the program reads
              <small className="p2-faint"> — every starter here reads a line, so this box is connected to something</small>
            </span>
            <textarea value={stdin} spellCheck={false} onChange={(event) => setStdin(event.target.value)} placeholder="One value per line" />
          </label>
        </div>
      )}

      {showing === 'languages' && (
        <>
          <h4 className="p4-heading">{languages.length} languages</h4>
          {byCategory.map(([category, rows]) => (
            <div key={category} className="p9-group">
              <div className="p9-group-head">{category}</div>
              <div className="p9-langs">
                {rows.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    className={`p9-lang${one.id === language ? ' here' : ''}`}
                    aria-pressed={one.id === language}
                    onClick={() => setLanguage(one.id)}
                  >
                    <strong>{one.name}</strong>
                    <code>.{one.extension}</code>
                    {!one.canReallyRun && <small>predicted only</small>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {showing === 'about' && (
        <>
          <h4 className="p4-heading">Where the answer comes from</h4>
          <p className="p9-about">
            {ready?.sandbox === true
              ? 'A sandbox is set up, so your code is sent there, compiled and run, and what you see is what it actually printed.'
              : 'Orion reads the code and says what it would print. That is how this works by default — it needs nothing set up, and it handles any language rather than a fixed list. It is a reading rather than a run, so it is labelled as one every time and never reports a running time.'}
          </p>
          <p className="p9-about">
            Nothing is ever run on this machine. Code goes to a remote sandbox or to a model that reads it, and
            there is deliberately no third route.
          </p>
          <h4 className="p4-heading">What this does not do</h4>
          <ul className="p8-limits">
            {notes.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </>
      )}
    </LabShell>
  )
}
