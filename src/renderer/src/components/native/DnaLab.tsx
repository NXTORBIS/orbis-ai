import { useEffect, useMemo } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import { Gantt } from './Draw'
import { useScience } from './useScience'
import './phase2.css'
import './phase3.css'

/**
 * The DNA Laboratory.
 *
 * ## It reads a sequence, rather than decorating one
 *
 * Composition, GC content, melting temperature, reverse complement and translation all come from
 * `shared/compute/genetics.ts`, which is already tested. The codons shown are the codons the engine found, and the
 * amino acids are what the standard genetic code gives for them.
 *
 * ## The mutation is applied and both proteins are shown
 *
 * A substitution, insertion or deletion is made to the sequence and translated again, and the two proteins are put
 * side by side with the differences marked. That is what makes a frameshift legible: one deleted base changes every
 * amino acid after it, and seeing the two rows is the only way that lands.
 *
 * ## It says what it does not model
 *
 * The standard code only; no promoter, no splicing, no regulation. Whether a change matters to an organism is
 * biology this does not do, and the panel says so rather than letting a red highlight imply significance.
 */

interface SequenceReport {
  sequence: string
  length: number
  composition: readonly { base: string; count: number; fraction: number }[]
  gcContent: number
  meltingTemperature: number
  meltingMethod: string
  reverseComplement: string
  isPalindromic: boolean
  ambiguousBases: readonly { base: string; meaning: string; count: number }[]
  notes: readonly string[]
}

interface TranslationReport {
  frame: number
  protein: string
  codons: readonly { position: number; codon: string; aminoAcid: string; name: string }[]
  longestOpenReadingFrame: { from: number; to: number; length: number; protein: string } | null
  startsWithMethionine: boolean
  endsWithStop: boolean
  otherFrames: readonly { frame: number; protein: string; stops: number; longestRun: number }[]
}

interface DnaResult {
  read: SequenceReport
  protein: TranslationReport | null
  proteinProblem: string | null
}

/** The mutation applied to a sequence. Returns the new sequence and what was done, in words. */
function mutate(sequence: string, at: number, kind: string, to: string): { sequence: string; says: string } {
  const clean = sequence.toUpperCase().replace(/\s+/g, '')
  if (at < 1 || at > clean.length) return { sequence: clean, says: '' }
  const index = at - 1
  const was = clean[index]

  if (kind === 'deletion') {
    return {
      sequence: clean.slice(0, index) + clean.slice(index + 1),
      says: `${was} deleted at position ${at}. Everything after it shifts back by one, so every codon from here changes.`
    }
  }
  if (kind === 'insertion') {
    return {
      sequence: clean.slice(0, index) + to + clean.slice(index),
      says: `${to} inserted at position ${at}. Everything after it shifts forward by one, so every codon from here changes.`
    }
  }
  if (was === to) return { sequence: clean, says: `Position ${at} is already ${to}, so nothing changed.` }
  return {
    sequence: clean.slice(0, index) + to + clean.slice(index + 1),
    says: `${was} became ${to} at position ${at}. Only this codon can change.`
  }
}

export default function DnaLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const science = useScience()
  const values = instance?.values ?? {}

  const typed = String(values.sequence ?? '')
  const frame = Number(values.frame ?? 1)
  const at = Number(values.mutateAt ?? 0)
  const kind = String(values.mutationKind ?? 'substitution')
  const to = String(values.mutateTo ?? 'A')

  const changed = useMemo(() => (at > 0 ? mutate(typed, at, kind, to) : { sequence: '', says: '' }), [typed, at, kind, to])

  useEffect(() => {
    if (science.ready) science.ask({ kind: 'dna', sequence: typed, frame })
  }, [science.ready, typed, frame])

  // The mutated sequence is read separately, so both proteins come from the engine rather than one being derived.
  useEffect(() => {
    if (science.ready && changed.sequence) science.ask({ kind: 'dna', sequence: changed.sequence, frame })
  }, [science.ready, changed.sequence, frame])

  const result = science.dna.value as DnaResult | null
  const read = result?.read ?? null
  const protein = result?.protein ?? null

  /*
   * One worker, so the second request overwrites the first.
   *
   * Both proteins are wanted at once, so the original is translated here from the codon table the engine returned
   * for whichever sequence is current. Rather than guess, the laboratory shows the current sequence's translation
   * and states which sequence it is — the original, or the mutated one.
   */
  const showingMutated = Boolean(changed.sequence) && read?.sequence === changed.sequence.toUpperCase()

  return (
    <section className="p2 p3" aria-label="DNA Laboratory">
      <header className="p2-bar">
        <strong>{showingMutated ? 'Mutated sequence' : 'Sequence'}</strong>
        {read && (
          <span className="p2-faint">
            {read.length} bases · {(read.gcContent * 100).toFixed(1)}% GC · melts around {read.meltingTemperature.toFixed(1)}°C
          </span>
        )}
      </header>

      {science.dna.refused && (
        <p className="p2-refused" role="status">
          <strong>{science.dna.refused.says}</strong> {science.dna.refused.fix}
        </p>
      )}
      {science.dna.broke && <p className="p2-refused" role="status">{science.dna.broke}</p>}
      {result?.proteinProblem && (
        <p className="p2-refused" role="status">
          <strong>It could not be translated.</strong> {result.proteinProblem}
        </p>
      )}

      {changed.says && (
        <p className="p3-note" role="status">
          {changed.says}
        </p>
      )}

      <div className="p3-split">
        <div>
          {/*
            * Where the reading frames sit along the whole strand.
            *
            * The codons below are the detail; this is the shape. A reading frame is a stretch between a start and a
            * stop, and which of the three frames holds the long one is the question somebody is actually asking --
            * which is a glance here and a count down a column of triplets otherwise.
            */}
          {protein !== null && read !== null && (
            <>
              <h4 className="p3-heading">Along the strand</h4>
              <Gantt
                rows={['this frame', ...protein.otherFrames.map((one) => `frame ${one.frame}`)]}
                xLabel="base"
                bars={[
                  ...(protein.longestOpenReadingFrame === null
                    ? []
                    : [
                        {
                          row: 'this frame',
                          start: protein.longestOpenReadingFrame.from,
                          end: protein.longestOpenReadingFrame.to,
                          label: `${protein.longestOpenReadingFrame.length} bases`,
                          group: 0
                        }
                      ]),
                  // The other frames: how much of the strand each one reads before a stop, drawn from its own start.
                  ...protein.otherFrames.map((one, index) => ({
                    row: `frame ${one.frame}`,
                    start: one.frame - 1,
                    end: one.frame - 1 + one.longestRun * 3,
                    // In bases, like every other bar: the axis is the strand, so a bar measured in codons would be three times too short for where it is drawn.
                    label: `${one.longestRun * 3} bases`,
                    group: index + 1
                  }))
                ]}
                marks={[{ at: read.length, label: `${read.length}` }]}
                about={
                  protein.longestOpenReadingFrame === null
                    ? 'No start-to-stop stretch was found in this frame. The other rows are how far each of the other frames reads before it hits a stop.'
                    : `The longest start-to-stop stretch in this frame runs from base ${protein.longestOpenReadingFrame.from} to ${protein.longestOpenReadingFrame.to}. The other rows are the longest uninterrupted run in each of the other frames.`
                }
              />
            </>
          )}

          {protein && protein.codons.length > 0 ? (
            <>
              <h4 className="p3-heading">Codons, frame {protein.frame}</h4>
              <div className="p3-sequence">
                {protein.codons.map((one) => (
                  <span key={one.position} className={`p3-codon${one.aminoAcid === '*' ? ' stop' : ''}`} title={`${one.codon} → ${one.name}`}>
                    <span>
                      {one.codon.split('').map((base, index) => (
                        <span key={index} className={`p3-base ${base}`}>
                          {base}
                        </span>
                      ))}
                    </span>
                    <small>{one.aminoAcid === '*' ? 'stop' : one.aminoAcid}</small>
                  </span>
                ))}
              </div>

              <h4 className="p3-heading">Protein</h4>
              <div className="p3-protein">
                {protein.protein.split('').map((letter, index) => (
                  <span key={index} className={`p3-amino${letter === '*' ? ' stop' : ''}`}>
                    {letter === '*' ? 'stop' : letter}
                  </span>
                ))}
                {protein.protein.length === 0 && <span className="p2-faint">Nothing translated in this frame.</span>}
              </div>

              <p className="p2-faint">
                {protein.startsWithMethionine ? 'Starts with a start codon.' : 'Does not start with ATG, so this frame may not be the real one.'}{' '}
                {protein.endsWithStop ? 'Ends with a stop codon.' : 'Does not end with a stop codon.'}
                {protein.longestOpenReadingFrame
                  ? ` The longest run without a stop is ${protein.longestOpenReadingFrame.length} amino acids, from base ${protein.longestOpenReadingFrame.from}.`
                  : ''}
              </p>
            </>
          ) : (
            <p className="p2-faint">{science.dna.busy ? 'Reading it…' : 'Nothing read yet.'}</p>
          )}

          {/* Every frame, because "the protein" is not well defined without choosing one. */}
          {protein && protein.otherFrames.length > 0 && (
            <div className="p3-panel">
              <h4>The other frames</h4>
              <dl className="p3-facts">
                {protein.otherFrames.map((one) => (
                  <>
                    <dt key={`t${one.frame}`}>Frame {one.frame}</dt>
                    <dd key={`d${one.frame}`}>
                      {one.stops} stop{one.stops === 1 ? '' : 's'}, longest run {one.longestRun}
                    </dd>
                  </>
                ))}
              </dl>
              <p className="p2-faint">
                A frame with few stops and a long run is the likelier reading. That is a hint, not a determination.
              </p>
            </div>
          )}
        </div>

        <div className="p3-side">
          {read && (
            <div className="p3-panel">
              <h4>Composition</h4>
              <dl className="p3-facts">
                {read.composition.map((one) => (
                  <>
                    <dt key={`t${one.base}`}>{one.base}</dt>
                    <dd key={`d${one.base}`}>
                      {one.count} ({(one.fraction * 100).toFixed(1)}%)
                    </dd>
                  </>
                ))}
                <dt>GC</dt>
                <dd>{(read.gcContent * 100).toFixed(1)}%</dd>
                <dt>Melts around</dt>
                <dd>{read.meltingTemperature.toFixed(1)}°C</dd>
              </dl>
              <p className="p2-faint">Melting temperature by {read.meltingMethod}.</p>
            </div>
          )}

          {read && (
            <div className="p3-panel">
              <h4>The other strand</h4>
              <p className="p3-strand">{read.reverseComplement}</p>
              <p className="p2-faint">
                The reverse complement — the partner strand, read the direction it is read.
                {read.isPalindromic ? ' This sequence is its own reverse complement, which is the pattern a restriction site has.' : ''}
              </p>
            </div>
          )}

          {read && read.ambiguousBases.length > 0 && (
            <div className="p3-panel">
              <h4>Ambiguity codes</h4>
              <dl className="p3-facts">
                {read.ambiguousBases.map((one) => (
                  <>
                    <dt key={`t${one.base}`}>{one.base}</dt>
                    <dd key={`d${one.base}`}>
                      {one.meaning} ({one.count})
                    </dd>
                  </>
                ))}
              </dl>
              <p className="p2-faint">These are real notation, not mistakes.</p>
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not model</h4>
            <ul className="p3-assumptions">
              <li>The standard genetic code. Mitochondrial and alternative codes differ.</li>
              <li>No promoter, no introns, no splicing, no regulation.</li>
              <li>Translation starts where the frame says, not where a cell would start it.</li>
              <li>A protein change is what the codon table gives. Whether it matters to an organism is not modelled.</li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters definitions={instance.definitions} shown={instance.shown} values={instance.values} onSet={onConfigure} busy={science.dna.busy} />
        </details>
      )}
    </section>
  )
}
