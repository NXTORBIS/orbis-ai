import { findSecrets, type SecretFinding } from '../pages/packaging.ts'

/**
 * The gate every artifact write goes through.
 *
 * `findSecrets` already knows what a credential looks like. Until now it ran in one place: when a Page was packed for
 * export. That left a hole the width of the whole feature -- a model handed a key could write it into a generated
 * file, the file sat in the library, and nothing noticed until somebody tried to export it, if they ever did. So the
 * scan runs at the moment of writing, and refuses the write.
 *
 * The refusal can be overridden by one thing only: a person who was shown each finding and said yes. `acceptSecrets`
 * is never set by code. The findings name the line and what it looks like, and never quote the match -- a message that
 * quotes a key has copied it into a log.
 */

export interface SecretGate {
  ok: boolean
  findings: SecretFinding[]
  /** Empty when ok. Otherwise a sentence a person can act on. */
  message: string
}

export function gateForWrite(name: string, text: string, acceptSecrets: boolean): SecretGate {
  const findings = findSecrets([{ path: name, content: text }])
  if (findings.length === 0 || acceptSecrets) return { ok: true, findings, message: '' }

  const kinds = [...new Set(findings.map((one) => one.looksLike))]
  const where = findings
    .slice(0, 4)
    .map((one) => `line ${one.line}`)
    .join(', ')
  const more = findings.length > 4 ? ` and ${findings.length - 4} more` : ''
  return {
    ok: false,
    findings,
    message: `Not written: ${findings.length === 1 ? 'something' : `${findings.length} things`} in it ${findings.length === 1 ? 'looks' : 'look'} like ${kinds.join(', ')} (${where}${more}). Remove ${findings.length === 1 ? 'it' : 'them'}, or confirm you want the file written as it is.`
  }
}
