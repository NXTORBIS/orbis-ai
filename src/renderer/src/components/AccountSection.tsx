import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AuthState } from '../../../shared/types'

/** Settings → Account: sign in with Google in the system browser, see who is signed in, sign out. */
export default function AccountSection(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.getAuthState().then(setAuth)
    return window.api.onAuthState(setAuth)
  }, [])

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  const status = auth?.status
  let description = 'Loading…'
  if (status === 'unconfigured') description = "Sign-in isn't set up in this copy of Orbis yet."
  else if (status === 'signed-out') description = 'Sign in with your Google account. It opens in your default browser; Orbis never sees your password.'
  else if (status === 'waiting') description = 'Finish signing in in your browser, then come back here.'
  else if (status === 'signing-in') description = 'Signing you in…'
  else if (status === 'signed-in') description = auth?.notice ?? `Signed in with ${auth?.provider ?? 'Google'}.`

  return (
    <section className="setting row account-setting">
      <div className="setting-label">
        <h3>Account</h3>
        <p>{description}</p>
        {auth?.error && (
          <p className="account-error" role="alert">
            {auth.error}
          </p>
        )}
      </div>
      <div className="account-actions">
        {status === 'signed-in' && auth?.user && (
          <div className="account-user">
            {auth.user.picture ? (
              <img className="account-avatar" src={auth.user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-avatar" aria-hidden="true">
                {(auth.user.name || auth.user.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="account-names">
              <b>{auth.user.name}</b>
              <span>{auth.user.email}</span>
            </span>
          </div>
        )}
        {(status === 'signed-out' || status === 'unconfigured') && (
          <button type="button" className="account-btn primary" disabled={status === 'unconfigured' || busy} onClick={() => run(() => window.api.signIn())}>
            Continue with Google
          </button>
        )}
        {status === 'waiting' && (
          <>
            <LoaderCircle size={15} className="spin account-spin" aria-hidden="true" />
            <button type="button" className="account-btn" onClick={() => run(() => window.api.signIn())}>
              Open browser again
            </button>
            <button type="button" className="account-btn" onClick={() => run(() => window.api.cancelSignIn())}>
              Cancel
            </button>
          </>
        )}
        {status === 'signing-in' && <LoaderCircle size={15} className="spin account-spin" aria-label="Signing in" />}
        {status === 'signed-in' && (
          <button type="button" className="account-btn" disabled={busy} onClick={() => run(() => window.api.signOut())}>
            Sign out
          </button>
        )}
      </div>
    </section>
  )
}
