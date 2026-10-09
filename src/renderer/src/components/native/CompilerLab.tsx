import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useCS } from './useCS'
import './phase7.css'

/**
 * The Compiler Laboratory — text, tokens, a tree, and output.
 *
 * ## All four stages, because the middle two are the subject
 *
 * Nearly every program anybody writes is compiled and almost nobody has seen the tokens. Showing the list, then the
 * tree, then the answer, is the laboratory: `3 + 4 * 2` becomes eleven because the multiplication sits *below* the
 * addition in the tree, and that is visible here rather than asserted.
 *
 * ## An error is a stage, not a failure
 *
 * A refusal says which of the three stages it came from — lexing, parsing or running — and where. "Unexpected
 * character '@' at 14" and "expected ';' on line 3" are different problems, and a card that said "error" would be
 * throwing away the only useful half of the message.
 */

interface Token {
  kind: string
  text: string
  value?: number
  from: number
  line: number
}

interface Report {
  tokens: readonly Token[]
  drawn: string
  result: { output: readonly string[]; variables: Readonly<Record<string, number>>; steps: number }
  says: string
  notes: readonly string[]
}

const KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({
  number: 'a number',
  keyword: 'a word the language reserves',
  name: 'a name you chose',
  operator: 'something that does arithmetic or compares',
  punctuation: 'structure — brackets and semicolons',
  end: 'the end'
})

export default function CompilerLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useCS()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('output')

  const source = String(values.source ?? '')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'compiler', source })
  }, [engine.ready, source])

  const held = engine.compiler.value
  const report = (held?.report ?? null) as Report | null
  const example = String(held?.example ?? '')

  // Each kind of token, counted, so the shape of the program is visible before the tree is.
  const counts = report === null ? [] : Object.entries(report.tokens.reduce<Record<string, number>>((out, one) => ({ ...out, [one.kind]: (out[one.kind] ?? 0) + 1 }), {}))

  return (
    <LabShell
      title="Compiler Laboratory"
      summary={report?.says}
      refused={engine.compiler.refused}
      broke={engine.compiler.broke}
      busy={engine.compiler.busy}
      waitingFor="Compiling…"
      ready={held !== null}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'output', label: 'Output' },
        { id: 'tokens', label: 'Tokens' },
        { id: 'tree', label: 'The tree' },
        { id: 'source', label: 'The program' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && (
            <>
              <Facts
                title="What happened"
                rows={[
                  ['Tokens', report.tokens.length - 1],
                  ['Tree nodes', report.drawn.split('\n').length],
                  ['Steps to run', report.result.steps],
                  ['Lines printed', report.result.output.length],
                  ['Variables', Object.keys(report.result.variables).length]
                ]}
              />
              {Object.keys(report.result.variables).length > 0 && (
                <div className="p3-panel">
                  <h4>Variables at the end</h4>
                  <dl className="p3-facts">
                    {Object.entries(report.result.variables).map(([name, value]) => (
                      <div key={name} className="p4-fact">
                        <dt>
                          <code>{name}</code>
                        </dt>
                        <dd>{Number.isInteger(value) ? value : value.toFixed(6).replace(/0+$/, '')}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </>
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'output' && report !== null && (
        <>
          <h4 className="p4-heading">What it printed</h4>
          {report.result.output.length === 0 ? (
            <p className="p4-says">It ran without printing anything. Add a <code>print</code> to see something here.</p>
          ) : (
            <pre className="p7-output">{report.result.output.join('\n')}</pre>
          )}
          <p className="p4-says">
            It took {report.result.steps.toLocaleString('en-GB')} steps through the tree to produce that. A loop shows
            up here as the step count climbing far above the number of lines you wrote.
          </p>
        </>
      )}

      {showing === 'tokens' && report !== null && (
        <>
          <h4 className="p4-heading">{report.tokens.length - 1} tokens</h4>
          <div className="p7-tokens">
            {report.tokens
              .filter((one) => one.kind !== 'end')
              .map((one, at) => (
                <span key={`${at}-${one.from}`} className={`p7-token k-${one.kind}`} title={KIND_WORDS[one.kind] ?? one.kind}>
                  {one.text}
                </span>
              ))}
          </div>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">How many</th>
                  <th scope="col">What it is</th>
                </tr>
              </thead>
              <tbody>
                {counts
                  .filter(([kind]) => kind !== 'end')
                  .map(([kind, count]) => (
                    <tr key={kind}>
                      <td>
                        <span className={`p7-token k-${kind}`}>{kind}</span>
                      </td>
                      <td>{count}</td>
                      <td className="p2-faint">{KIND_WORDS[kind] ?? ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="p4-says">
            This is the whole of the first stage: the text has become a list of pieces, and every space, newline and
            comment has gone. Nothing yet knows what any of it means.
          </p>
        </>
      )}

      {showing === 'tree' && report !== null && (
        <>
          <h4 className="p4-heading">The tree</h4>
          {/*
            * Drawn with indentation rather than as a picture.
            *
            * The nesting is the whole content — a multiplication under an addition means it happens first — and
            * indentation shows that at any depth, where a drawn tree would run out of room.
            */}
          <pre className="p7-tree">{report.drawn}</pre>
          <p className="p4-says">
            Precedence lives here and nowhere else. In <code>3 + 4 * 2</code> the multiply sits below the add, so it
            happens first — not because of a rule applied afterwards, but because that is the shape the parser built.
          </p>
        </>
      )}

      {showing === 'source' && (
        <>
          <h4 className="p4-heading">The program</h4>
          <pre className="p7-source">{source.trim() === '' ? example : source}</pre>
          <p className="p4-says">
            The language has numbers, names, <code>+ - * / %</code>, comparison, <code>if</code>/<code>else</code>,{' '}
            <code>while</code> and <code>print</code>. No functions, no strings, no types — it is the shape of a
            compiler rather than a language to write anything real in, and it says so rather than implying otherwise.
          </p>
        </>
      )}
    </LabShell>
  )
}
