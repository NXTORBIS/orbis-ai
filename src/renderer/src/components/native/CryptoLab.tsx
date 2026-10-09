import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useCS } from './useCS'
import './phase7.css'

/**
 * The Cybersecurity Laboratory — hashing, encoding and the classical ciphers.
 *
 * ## It says what each thing does not do, on every screen
 *
 * The most common mistake in this area is believing that unreadable means protected. Base64 hides nothing. Caesar
 * is broken by trying twenty-six keys, and this laboratory does exactly that in front of you. XOR with a repeating
 * key is broken by anybody who knows the method. Each screen says so, because a tool that quietly let somebody
 * think otherwise would be doing harm.
 *
 * ## The avalanche is counted, not described
 *
 * Change one character and the laboratory counts how many of the 256 bits moved. It is about half, every time, and
 * that number is the property the whole thing rests on.
 */

interface HashReport {
  hex: string
  bytes: number
  padded: number
  blocks: number
  rounds: readonly { round: number; a: string; e: string }[]
  compared: string | null
  differingBits: number | null
  says: string
  notes: readonly string[]
}

interface EncodeReport {
  base64: string
  hex: string
  roundTrip: string | null
  bytes: number
  characters: number
}

interface CaesarReport {
  shifted: string
  rot13: string
  back: string
  shift: number
}

interface XorReport {
  hex: string
  text: string
  keyLength: number
  roundTrip: string | null
  says: string
  notes: readonly string[]
}

interface BreakReport {
  tries: readonly { shift: number; text: string; score: number }[]
  best: number
  says: string
}

export default function CryptoLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useCS()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('hash')

  const text = String(values.text ?? 'The quick brown fox jumps over the lazy dog')
  const key = String(values.key ?? 'orbis')
  const shift = Number(values.shift ?? 3)
  const compareWith = String(values.compareWith ?? '')

  useEffect(() => {
    if (!engine.ready) return
    const what = showing === 'encode' ? 'encode' : showing === 'caesar' ? 'caesar' : showing === 'xor' ? 'xor' : showing === 'break' ? 'break' : 'hash'
    engine.ask({ kind: 'crypto', what, text, key, shift, compareWith })
  }, [engine.ready, showing, text, key, shift, compareWith])

  const held = engine.crypto.value
  const what = String(held?.what ?? 'hash')
  const notes = (held?.notes ?? []) as readonly string[]
  const hash = what === 'hash' ? ((held?.report ?? null) as HashReport | null) : null
  const encode = what === 'encode' ? ((held?.report ?? null) as EncodeReport | null) : null
  const caesar = what === 'caesar' ? ((held?.report ?? null) as CaesarReport | null) : null
  const xor = what === 'xor' ? ((held?.report ?? null) as XorReport | null) : null
  const broken = what === 'break' ? ((held?.report ?? null) as BreakReport | null) : null

  return (
    <LabShell
      title="Cybersecurity"
      summary={hash?.says ?? xor?.says ?? broken?.says}
      refused={engine.crypto.refused}
      broke={engine.crypto.broke}
      busy={engine.crypto.busy}
      waitingFor="Working…"
      ready={held !== null}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'hash', label: 'SHA-256' },
        { id: 'encode', label: 'Encoding' },
        { id: 'caesar', label: 'Caesar' },
        { id: 'break', label: 'Breaking it' },
        { id: 'xor', label: 'XOR' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {hash !== null && (
            <Facts
              title="The message"
              rows={[
                ['Bytes', hash.bytes],
                ['After padding', hash.padded],
                ['Blocks of 64', hash.blocks],
                ['Rounds', hash.blocks * 64],
                ['Bits that differ', hash.differingBits === null ? '' : `${hash.differingBits} of 256`]
              ]}
              about="The digest is always 256 bits however long the message is, which is why it cannot be undone — there is nowhere for the rest to have gone."
            />
          )}
          {encode !== null && (
            <Facts
              title="Sizes"
              rows={[
                ['Characters', encode.characters],
                ['Bytes as UTF-8', encode.bytes],
                ['Base64 length', encode.base64.length],
                ['Growth', `${Math.round((encode.base64.length / Math.max(1, encode.bytes)) * 100)}%`]
              ]}
              about="Base64 turns three bytes into four characters, so it is always about a third larger. That is the cost of making bytes safe to put in text."
            />
          )}
          {xor !== null && (
            <Facts
              title="The key"
              rows={[
                ['Length', `${xor.keyLength} bytes`],
                ['Came back', xor.roundTrip === text ? 'yes — XOR is its own inverse' : 'no']
              ]}
            />
          )}
          <Notes title="Read this" notes={notes} />
        </>
      }
    >
      {showing === 'hash' && hash !== null && (
        <>
          <h4 className="p4-heading">SHA-256</h4>
          <div className="p7-digest">{hash.hex}</div>
          {hash.compared !== null && (
            <>
              <div className="p7-digest other">{hash.compared}</div>
              <p className="p4-says">
                {hash.differingBits} of the 256 bits are different — about half, which is what it should be. Change one
                character and the whole digest changes, with no part of the original left anywhere in it.
              </p>
            </>
          )}
          <h4 className="p4-heading">The last block, round by round</h4>
          {/*
            * Two of the eight working variables, every round.
            *
            * Showing all eight would be a wall of hexadecimal; a and e are the two that feed back into the next
            * round, and watching them is enough to see that nothing settles down.
            */}
          <div className="p2-table-wrap p7-scroll">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">a</th>
                  <th scope="col">e</th>
                </tr>
              </thead>
              <tbody>
                {hash.rounds.filter((_, at) => at % 4 === 0 || at === hash.rounds.length - 1).map((one) => (
                  <tr key={one.round}>
                    <td>{one.round}</td>
                    <td><code>{one.a}</code></td>
                    <td><code>{one.e}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'encode' && encode !== null && (
        <>
          <h4 className="p4-heading">Base64</h4>
          <pre className="p7-output">{encode.base64}</pre>
          <h4 className="p4-heading">The same bytes, as hexadecimal</h4>
          <pre className="p7-output small">{encode.hex}</pre>
          <p className="p4-says">
            Both of these are the same bytes written differently. {encode.roundTrip === text ? 'Decoding gives the original back exactly.' : 'The round trip did not match, which would be a fault.'}{' '}
            <strong>Neither hides anything</strong> — anybody can undo them with no secret at all, which is why
            encoding is not encryption however unreadable it looks.
          </p>
        </>
      )}

      {showing === 'caesar' && caesar !== null && (
        <>
          <h4 className="p4-heading">Shifted by {caesar.shift}</h4>
          <pre className="p7-output">{caesar.shifted}</pre>
          <h4 className="p4-heading">ROT13</h4>
          <pre className="p7-output">{caesar.rot13}</pre>
          <p className="p4-says">
            ROT13 is Caesar by thirteen, and thirteen is half of twenty-six — which is the only reason it has its own
            name: doing it twice gives the original back. There is no key and no secret in it at all.
          </p>
        </>
      )}

      {showing === 'break' && broken !== null && (
        <>
          <h4 className="p4-heading">All twenty-six shifts</h4>
          <p className="p4-says">
            There is no cleverness here, and that is the lesson: a cipher with twenty-six possible keys is broken by
            trying all twenty-six. The scoring only decides which to show you first.
          </p>
          <div className="p2-table-wrap p7-scroll">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Shift</th>
                  <th scope="col">What it gives</th>
                </tr>
              </thead>
              <tbody>
                {[...broken.tries].sort((a, b) => b.score - a.score).map((one) => (
                  <tr key={one.shift} className={one.shift === broken.best ? 'p7-accepting' : undefined}>
                    <td>{one.shift}</td>
                    <td className={one.shift === broken.best ? undefined : 'p2-faint'}>{one.text.slice(0, 70)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'xor' && xor !== null && (
        <>
          <h4 className="p4-heading">XOR with a repeating key</h4>
          <pre className="p7-output small">{xor.hex}</pre>
          <p className="p4-says">{xor.says}</p>
          <h4 className="p4-heading">And back again</h4>
          <pre className="p7-output">{xor.roundTrip ?? '—'}</pre>
          <p className="p4-says">
            The same operation undoes it, which is why one function does both directions. Shown as hexadecimal
            because XOR of text is usually not text, and printing it as text would hide the bytes that cannot be
            printed.
          </p>
        </>
      )}
    </LabShell>
  )
}
