import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import type { AccountStatus } from '../../../shared/account'
import { isRefusal } from '../../../shared/account'
import { confirmPassword, judgePassword, PASSWORD_MAX, PASSWORD_MIN } from '../../../shared/passwordStrength'

/**
 * The password on this profile's account, in Settings.
 *
 * Two jobs, because an account arrives here in one of two states:
 *
 *  - It has a password, and the person wants to change it. The current one is required, and changing it rewraps the
 *    account key rather than re-encrypting anything -- so nothing can be lost by doing it.
 *  - It has none, because it was made before Orbis had them. It is offered one. Nothing is forced and nothing is reset:
 *    an account without a password keeps working exactly as it did.
 *
 * Nothing is decided in this file. Every judgement about a password is `shared/passwordStrength`, and every judgement
 * about the account is the main process's. This asks, shows what came back, and holds nothing afterwards.
 *
 * ## Why the three rows here are not the shared `Field`
 *
 * They look exactly like one -- a name, a box, a sentence under it -- and they cannot become one until the stylesheet
 * moves. This family names a row with a bare `<span>` and styles it by where it sits: `.pw-row > span:first-child` is
 * the only thing making a name 12px and dim. `Field` names a control with a `<label>`, because a name has to point at
 * the box it names, and a `<label>` in that slot matches nothing -- so all three names would come out at the window's
 * own 14px in full text colour. That is a visible change wearing a construction change's clothes, which is the one
 * thing this pass must not do, so the rows stay hand-written and the reason is written down instead.
 *
 * Two declarations for a `label` in that slot, in `styles/parts/13-choosing-widgets-in-customize.css`, and all three
 * convert for nothing -- along with the six in `TabLockSettings`, which borrows this family wholesale.
 *
 * What that conversion would have fixed, and so is still true: the sentences under the new password and the
 * confirmation are pointed at by nothing, so each is only ever read out when it turns into an alert; and the reveal
 * button sits inside the labelling element, which means the new password box takes "Show passwords" into its own name.
 */

interface Props {
  /** The person's name, so a password that is just their name can be refused before it is sent. */
  userName: string
}

type Mode = 'idle' | 'working'

export default function AccountPasswordSettings({ userName }: Props): React.JSX.Element {
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')

  const read = useCallback(async () => {
    const said = await window.api.accountStatus()
    if (!isRefusal(said)) setStatus(said)
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  /** Everything typed, forgotten. Called after success and after closing, so nothing lingers in a React tree. */
  const clear = (): void => {
    setCurrent('')
    setNext('')
    setAgain('')
    setShown(false)
    setProblem('')
  }

  const has = status?.hasPassword === true
  const strength = judgePassword(next, userName)
  const match = confirmPassword(next, again)
  const ready = strength.ok && match.ok && (!has || current.length > 0)

  const submit = async (): Promise<void> => {
    if (!ready || mode === 'working') return
    setMode('working')
    setProblem('')
    try {
      const said = has
        ? await window.api.accountChange(current, next, userName)
        : await window.api.accountCreate(next, userName)
      if (isRefusal(said)) {
        const seconds = Math.ceil((said.waitMs ?? 0) / 1000)
        setProblem(
          said.error === 'cooling-down'
            ? `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
            : (said.message ?? 'That did not work.')
        )
        return
      }
      setStatus(said)
      clear()
      setOpen(false)
      setDone(has ? 'Password changed.' : 'Password set.')
    } finally {
      setMode('idle')
    }
  }

  // The confirmation fades rather than staying on screen for ever.
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(''), 4000)
    return () => clearTimeout(timer)
  }, [done])

  const reveal = (
    <button
      type="button"
      className="pw-reveal"
      aria-label={shown ? 'Hide passwords' : 'Show passwords'}
      title={shown ? 'Hide passwords' : 'Show passwords'}
      onClick={() => setShown((was) => !was)}
    >
      {shown ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  )

  return (
    <section className="setting">
      <div className="setting-label">
        <h3>Account password</h3>
        <p>
          {has
            ? 'Protects this profile on this computer. Orbis cannot recover it for you.'
            : 'This profile has no password. Adding one protects it on this computer; nothing you already have changes.'}
        </p>
      </div>

      <div className="pw-panel">
        <p className="pw-state">
          {has ? <ShieldCheck size={15} /> : <Lock size={15} />}
          <span>{has ? 'A password is set.' : 'No password.'}</span>
          {done && (
            <span className="pw-done" role="status">
              {done}
            </span>
          )}
        </p>

        {!open ? (
          <button
            type="button"
            className="queue-btn small"
            onClick={() => {
              clear()
              setOpen(true)
            }}
          >
            {has ? 'Change password' : 'Set a password'}
          </button>
        ) : (
          <form
            className="pw-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {/* These three rows are deliberately not the shared `Field`: the family styles a row's name by where the
                span sits, so `Field`'s `<label>` would wear nothing. The reason, and the one line that undoes it, are
                at the top of this file. */}

            {/* Only asked for when there is one. Requiring it is what stops anything that reaches this taking the account over. */}
            {has && (
              <label className="pw-row">
                <span>Current password</span>
                <span className="pw-field">
                  <input
                    type={shown ? 'text' : 'password'}
                    value={current}
                    maxLength={PASSWORD_MAX}
                    autoComplete="current-password"
                    autoFocus
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </span>
              </label>
            )}

            <label className="pw-row">
              <span>{has ? 'New password' : 'Password'}</span>
              <span className="pw-field has-reveal">
                <input
                  type={shown ? 'text' : 'password'}
                  value={next}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  autoFocus={!has}
                  aria-invalid={next.length >= PASSWORD_MIN && !strength.ok}
                  onChange={(e) => setNext(e.target.value)}
                />
                {reveal}
              </span>
            </label>

            <div className="pw-meter" aria-hidden="true" data-strength={next ? strength.strength : 'none'}>
              <span style={{ width: `${(strength.score / 4) * 100}%` }} />
            </div>
            <p className="pw-note" role={strength.problem ? 'alert' : undefined}>
              {next.length >= PASSWORD_MIN && strength.problem
                ? strength.problem
                : next && strength.ok
                  ? `${strength.strength[0].toUpperCase()}${strength.strength.slice(1)}. ${strength.advice}`.trim()
                  : `At least ${PASSWORD_MIN} characters. A few ordinary words beat one clever one.`}
            </p>

            <label className="pw-row">
              <span>Confirm</span>
              <span className="pw-field">
                <input
                  type={shown ? 'text' : 'password'}
                  value={again}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  aria-invalid={again.length >= next.length && Boolean(match.problem)}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </span>
            </label>
            <p className="pw-note" role={match.problem ? 'alert' : undefined}>
              {again.length >= next.length && match.problem ? match.problem : again && match.ok ? 'They match.' : ' '}
            </p>

            {problem && (
              <p className="pw-note" role="alert">
                {problem}
              </p>
            )}

            {/* Said plainly, because it is the one thing about this that cannot be undone. */}
            {!has && (
              <p className="pw-note is-quiet">
                Keep it somewhere safe. There is no way to recover it, because nothing else on this computer knows it.
              </p>
            )}

            <div className="pw-acts">
              <button
                type="button"
                className="queue-btn small"
                onClick={() => {
                  clear()
                  setOpen(false)
                }}
              >
                Cancel
              </button>
              <button type="submit" className="queue-btn small primary" disabled={!ready || mode === 'working'}>
                {mode === 'working' ? 'Saving…' : has ? 'Change password' : 'Set password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
