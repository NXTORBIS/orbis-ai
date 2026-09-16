import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Lock, Plus, RefreshCw, Settings2, Star, Trash2, Unlock, X } from 'lucide-react'
import {
  AUTO_LOCK_CHOICES,
  checkMasterPassword,
  defaultGenerator,
  KIND_LABEL,
  makePassword,
  matchesSearch,
  saidAutoLock,
  SECRET_KINDS,
  strengthBits
} from '../../../shared/vault'
import type { GeneratorOptions, SecretInput, SecretKind, SecretSummary, VaultStatus } from '../../../shared/vault'
import { isVaultError } from '../../../shared/types'
import type { NoticeKind } from '../App'

/**
 * The secrets of the profile in use.
 *
 * Locked until the master password is given, and locked again on its own after a while. What is listed is what a
 * secret says about itself — its name, what it is for, which site it belongs to — never the secret. A value is asked
 * for one at a time, shown briefly, and forgotten.
 *
 * Nothing here holds the master password beyond the moment it is used, and nothing here ever reaches Orion: this is a
 * screen onto a vault whose key never leaves the main process.
 */

const REVEAL_MS = 20_000

const WHY: Record<string, string> = {
  'wrong-password': 'That is not the master password.',
  'wrong-answer': 'That is not the answer.',
  'no-recovery': 'This vault has no recovery question, so it cannot be recovered. Its secrets can only be reached with the master password.',
  'no-vault': 'There is no vault on this profile yet.',
  'already-exists': 'This profile already has a vault.',
  locked: 'The vault locked itself.',
  'not-found': 'That secret is no longer there.',
  'bad-input': 'There is nothing to save.',
  io: 'The vault could not be read or written.'
}

const saidWhy = (code: string): string => WHY[code] ?? 'That could not be done.'

export default function SecretsPanel({ onNotify }: { onNotify?(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [secrets, setSecrets] = useState<SecretSummary[]>([])
  const [query, setQuery] = useState('')
  const [screen, setScreen] = useState<'list' | 'add' | 'settings' | 'generator' | 'recover'>('list')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await window.api.vaultStatus()
    if (isVaultError(next)) return
    setStatus(next)
    if (next.unlocked) {
      const listed = await window.api.vaultList()
      setSecrets(isVaultError(listed) ? [] : listed)
    } else {
      // Locked means the window shows nothing of it either.
      setSecrets([])
      setScreen('list')
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.api.onVaultLocked(() => void refresh())
  }, [refresh])

  // Whatever was on screen goes when the panel does.
  useEffect(() => () => setSecrets([]), [])

  const run = async <T,>(what: Promise<T | { error: string }>, after?: (value: T) => void): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    try {
      const value = await what
      if (isVaultError(value)) {
        setProblem(saidWhy(value.error))
        return false
      }
      after?.(value as T)
      await refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <p className="vault-none">Opening…</p>

  if (!status.exists) return <VaultSetup busy={busy} problem={problem} onCreate={(password, recovery) => run(window.api.vaultCreate(password, recovery))} />

  if (!status.unlocked) {
    return screen === 'recover' ? (
      <VaultRecover busy={busy} problem={problem} onBack={() => (setProblem(null), setScreen('list'))} onRecover={(answer, password) => run(window.api.vaultRecover(answer, password))} />
    ) : (
      <VaultLocked busy={busy} problem={problem} onUnlock={(password) => run(window.api.vaultUnlock(password))} onForgot={() => (setProblem(null), setScreen('recover'))} />
    )
  }

  const shown = secrets.filter((s) => matchesSearch(s, query))

  return (
    <div className="vault">
      <header className="vault-bar">
        <input className="vault-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${secrets.length} secrets`} aria-label="Search secrets" spellCheck={false} />
        <button type="button" className="queue-btn primary" onClick={() => setScreen(screen === 'add' ? 'list' : 'add')}>
          <Plus size={13} /> Add secret
        </button>
        <button type="button" className="b-icon" aria-label="Password generator" title="Password generator" onClick={() => setScreen(screen === 'generator' ? 'list' : 'generator')}>
          <RefreshCw size={14} />
        </button>
        <button type="button" className="b-icon" aria-label="Vault settings" title="Settings" onClick={() => setScreen(screen === 'settings' ? 'list' : 'settings')}>
          <Settings2 size={14} />
        </button>
        <button type="button" className="b-icon" aria-label="Lock the vault" title="Lock now" onClick={() => void run(window.api.vaultLock())}>
          <Lock size={14} />
        </button>
      </header>

      {problem && <p className="vault-problem">{problem}</p>}

      {screen === 'add' && <SecretForm busy={busy} onCancel={() => setScreen('list')} onSave={async (secret) => {
            if (await run(window.api.vaultAdd(secret))) setScreen('list')
          }} />}
      {screen === 'generator' && <Generator onNotify={onNotify} onSave={async (secret) => {
            if (await run(window.api.vaultAdd(secret))) setScreen('list')
          }} />}
      {screen === 'settings' && (
        <VaultSettings
          status={status}
          busy={busy}
          onChangePassword={(current, next) => run(window.api.vaultChangePassword(current, next))}
          onRecovery={(password, recovery) => run(window.api.vaultSetRecovery(password, recovery))}
          onAutoLock={(password, ms) => run(window.api.vaultAutoLock(password, ms))}
          onDestroy={(password) => run(window.api.vaultDestroy(password))}
        />
      )}

      {screen === 'list' && (
        <ul className="vault-list">
          {shown.map((secret) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              onNotify={onNotify}
              onRemove={() => void run(window.api.vaultRemove(secret.id))}
              onSave={(next) => run(window.api.vaultUpdate(secret.id, next))}
            />
          ))}
          {!shown.length && <p className="vault-none">{secrets.length ? 'Nothing matches that.' : 'Nothing kept here yet. Add an API key, a password, or a note.'}</p>}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the ways in

function VaultSetup({ busy, problem, onCreate }: { busy: boolean; problem: string | null; onCreate(password: string, recovery?: { question: string; answer: string }): Promise<boolean> }): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  return (
    <form
      className="vault-gate"
      onSubmit={(e) => {
        e.preventDefault()
        const wrong = checkMasterPassword(password)
        if (wrong) return setSaid(wrong)
        if (password !== again) return setSaid('Those two are not the same.')
        setSaid(null)
        void onCreate(password, question.trim() && answer ? { question: question.trim(), answer } : undefined)
      }}
    >
      <h3>
        <KeyRound size={16} aria-hidden="true" /> Make a vault
      </h3>
      <p className="vault-note">
        The master password is the only way in. It is never stored — what is kept is a locked vault that only it opens — so if it is lost, the recovery question below is the
        one other way back in.
      </p>
      <label>
        Master password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
      </label>
      <label>
        Again
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        Recovery question <small>your own words, and optional</small>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What was your first phone?" />
      </label>
      <label>
        Answer
        <input type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" />
      </label>
      {(said || problem) && <p className="vault-problem">{said ?? problem}</p>}
      <button type="submit" className="queue-btn primary" disabled={busy}>
        {busy ? 'Making it…' : 'Make the vault'}
      </button>
    </form>
  )
}

function VaultLocked({ busy, problem, onUnlock, onForgot }: { busy: boolean; problem: string | null; onUnlock(password: string): Promise<boolean>; onForgot(): void }): React.JSX.Element {
  const [password, setPassword] = useState('')
  return (
    <form
      className="vault-gate"
      onSubmit={(e) => {
        e.preventDefault()
        if (password) void onUnlock(password).then((ok) => ok && setPassword(''))
      }}
    >
      <h3>
        <Lock size={16} aria-hidden="true" /> Vault locked
      </h3>
      <label>
        Master password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {problem && <p className="vault-problem">{problem}</p>}
      <button type="submit" className="queue-btn primary" disabled={busy || !password}>
        <Unlock size={13} /> {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button type="button" className="vault-link" onClick={onForgot}>
        Forgot password?
      </button>
    </form>
  )
}

function VaultRecover({ busy, problem, onBack, onRecover }: { busy: boolean; problem: string | null; onBack(): void; onRecover(answer: string, password: string): Promise<boolean> }): React.JSX.Element {
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [password, setPassword] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    void window.api.vaultQuestion().then((q) => setQuestion(isVaultError(q) ? null : q))
  }, [])

  if (question === null) {
    return (
      <div className="vault-gate">
        <h3>Forgot master password</h3>
        <p className="vault-note">
          This vault has no recovery question, so there is no way to open it without the master password. That is what makes it a vault: nobody, including Orbis, can read it
          without that password. A vault that cannot be opened can be deleted from Settings, which permanently removes what is in it.
        </p>
        <button type="button" className="queue-btn" onClick={onBack}>
          Back
        </button>
      </div>
    )
  }

  return (
    <form
      className="vault-gate"
      onSubmit={(e) => {
        e.preventDefault()
        const wrong = checkMasterPassword(password)
        if (wrong) return setSaid(wrong)
        setSaid(null)
        void onRecover(answer, password)
      }}
    >
      <h3>Forgot master password</h3>
      <p className="vault-note">{question}</p>
      <label>
        Answer
        <input type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <label>
        New master password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      {(said || problem) && <p className="vault-problem">{said ?? problem}</p>}
      <button type="submit" className="queue-btn primary" disabled={busy || !answer || !password}>
        {busy ? 'Checking…' : 'Unlock and set a new password'}
      </button>
      <button type="button" className="vault-link" onClick={onBack}>
        Back
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- one secret

function SecretRow({ secret, onRemove, onSave, onNotify }: { secret: SecretSummary; onRemove(): void; onSave(next: SecretInput): Promise<boolean>; onNotify?(m: string, k?: NoticeKind): void }): React.JSX.Element {
  const [shownValue, setShownValue] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A revealed secret goes back behind the dots on its own, and whenever this row goes away.
  useEffect(() => () => { if (hide.current) clearTimeout(hide.current) }, [])

  const reveal = async (): Promise<void> => {
    if (shownValue) {
      setShownValue(null)
      return
    }
    const full = await window.api.vaultReveal(secret.id)
    if (isVaultError(full)) return onNotify?.(saidWhy(full.error), 'warn')
    setShownValue(full.value || '(nothing in it)')
    if (hide.current) clearTimeout(hide.current)
    hide.current = setTimeout(() => setShownValue(null), REVEAL_MS)
  }

  const copy = async (): Promise<void> => {
    const full = await window.api.vaultReveal(secret.id)
    if (isVaultError(full)) return onNotify?.(saidWhy(full.error), 'warn')
    try {
      await navigator.clipboard.writeText(full.value)
      onNotify?.(`${secret.name} copied.`)
    } catch {
      onNotify?.('That could not be copied.', 'warn')
    }
  }

  if (editing) {
    return (
      <li className="vault-item editing">
        <SecretForm
          existing={secret}
          busy={false}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            if (await onSave(next)) setEditing(false)
          }}
        />
      </li>
    )
  }

  return (
    <li className="vault-item">
      <span className="vault-item-text">
        <b className="truncate">
          {secret.favorite && <Star size={12} fill="currentColor" aria-label="Favourite" />}
          {secret.name}
        </b>
        <small className="truncate">
          {KIND_LABEL[secret.kind]}
          {secret.provider ? ` · ${secret.provider}` : ''}
          {secret.username ? ` · ${secret.username}` : ''}
        </small>
        <code className="vault-value">{shownValue ?? '••••••••••••••••'}</code>
      </span>
      <span className="vault-item-actions">
        <button type="button" aria-label={shownValue ? 'Hide' : 'Reveal'} title={shownValue ? 'Hide' : 'Reveal'} onClick={() => void reveal()}>
          {shownValue ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button type="button" aria-label="Copy" title="Copy" onClick={() => void copy()}>
          <Copy size={13} />
        </button>
        <button type="button" aria-label="Edit" title="Edit" onClick={() => setEditing(true)}>
          <Settings2 size={13} />
        </button>
        {confirming ? (
          <>
            <button type="button" className="vault-danger" onClick={onRemove}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              <X size={13} />
            </button>
          </>
        ) : (
          <button type="button" aria-label="Delete" title="Delete" onClick={() => setConfirming(true)}>
            <Trash2 size={13} />
          </button>
        )}
      </span>
    </li>
  )
}

function SecretForm({ existing, busy, onCancel, onSave }: { existing?: SecretSummary; busy: boolean; onCancel(): void; onSave(secret: SecretInput): void | Promise<void> }): React.JSX.Element {
  const [kind, setKind] = useState<SecretKind>(existing?.kind ?? 'apiKey')
  const [name, setName] = useState(existing?.name ?? '')
  const [value, setValue] = useState('')
  const [provider, setProvider] = useState(existing?.provider ?? '')
  const [website, setWebsite] = useState(existing?.website ?? '')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [favorite, setFavorite] = useState(existing?.favorite ?? false)

  // Editing starts from what is there now, which means reading the one secret being edited.
  useEffect(() => {
    if (!existing) return
    void window.api.vaultReveal(existing.id).then((full) => {
      if (isVaultError(full)) return
      setValue(full.value)
      setNotes(full.notes ?? '')
    })
  }, [existing])

  return (
    <form
      className="vault-form"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({ kind, name, value, provider, website, username, notes, category, favorite, tags: [] })
      }}
    >
      <div className="vault-kinds">
        {SECRET_KINDS.map((one) => (
          <button key={one} type="button" className={`vault-kind${one === kind ? ' on' : ''}`} onClick={() => setKind(one)}>
            {KIND_LABEL[one]}
          </button>
        ))}
      </div>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Groq API" autoFocus={!existing} />
      </label>
      {kind === 'apiKey' && (
        <label>
          Provider
          <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Groq" />
        </label>
      )}
      {(kind === 'password' || kind === 'login') && (
        <>
          <label>
            Website
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="mail.example.com" />
          </label>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </label>
        </>
      )}
      <label>
        {kind === 'note' ? 'Secure note' : kind === 'recoveryCode' ? 'Recovery codes' : 'Secret'}
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={kind === 'note' || kind === 'recoveryCode' ? 5 : 2} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>
      <label>
        Category
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Work" />
      </label>
      <label className="vault-check">
        <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> Keep at the top
      </label>
      <div className="vault-form-actions">
        <button type="submit" className="queue-btn primary" disabled={busy}>
          <Check size={13} /> Save
        </button>
        <button type="button" className="queue-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- making a password

function Generator({ onSave, onNotify }: { onSave(secret: SecretInput): void; onNotify?(m: string, k?: NoticeKind): void }): React.JSX.Element {
  const [options, setOptions] = useState<GeneratorOptions>(defaultGenerator)
  const [made, setMade] = useState('')
  const [shown, setShown] = useState(false)

  // The randomness is the platform's cryptographic source, never Math.random.
  const generate = useCallback((o: GeneratorOptions) => setMade(makePassword(o, (n) => crypto.getRandomValues(new Uint8Array(n)))), [])
  useEffect(() => generate(options), [options, generate])

  const set = (changes: Partial<GeneratorOptions>): void => setOptions((now) => ({ ...now, ...changes }))

  return (
    <div className="vault-generator">
      <label className="vault-length">
        Length <b>{options.length}</b>
        <input type="range" min={8} max={64} value={options.length} onChange={(e) => set({ length: Number(e.target.value) })} />
      </label>
      <div className="vault-checks">
        {([['uppercase', 'A-Z'], ['lowercase', 'a-z'], ['numbers', '0-9'], ['symbols', '!@#'], ['avoidAmbiguous', 'No look-alikes']] as const).map(([key, label]) => (
          <label key={key} className="vault-check">
            <input type="checkbox" checked={options[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<GeneratorOptions>)} /> {label}
          </label>
        ))}
      </div>
      <div className="vault-made">
        <code>{made ? (shown ? made : '•'.repeat(Math.min(made.length, 48))) : 'Choose at least one kind of character.'}</code>
        <button type="button" aria-label={shown ? 'Hide' : 'Show'} title={shown ? 'Hide' : 'Show'} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      {made && <p className="vault-note">About {strengthBits(made, options)} bits to guess.</p>}
      <div className="vault-form-actions">
        <button type="button" className="queue-btn" onClick={() => generate(options)}>
          <RefreshCw size={13} /> Again
        </button>
        <button
          type="button"
          className="queue-btn"
          disabled={!made}
          onClick={() => void navigator.clipboard.writeText(made).then(() => onNotify?.('Copied.'), () => onNotify?.('That could not be copied.', 'warn'))}
        >
          <Copy size={13} /> Copy
        </button>
        <button type="button" className="queue-btn primary" disabled={!made} onClick={() => onSave({ kind: 'password', name: 'New password', value: made, tags: [] })}>
          <Plus size={13} /> Keep it
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the vault's own settings

function VaultSettings({
  status,
  busy,
  onChangePassword,
  onRecovery,
  onAutoLock,
  onDestroy
}: {
  status: VaultStatus
  busy: boolean
  onChangePassword(current: string, next: string): Promise<boolean>
  onRecovery(password: string, recovery: { question: string; answer: string } | null): Promise<boolean>
  onAutoLock(password: string, ms: number): Promise<boolean>
  onDestroy(password: string): Promise<boolean>
}): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="vault-settings">
      <section>
        <h4>Change master password</h4>
        <p className="vault-note">The secrets are not re-encrypted: what changes is the lock on the key that opens them.</p>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current master password" autoComplete="current-password" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New master password" autoComplete="new-password" />
        <button type="button" className="queue-btn" disabled={busy || !current || Boolean(checkMasterPassword(next))} onClick={() => void onChangePassword(current, next).then((ok) => ok && (setCurrent(''), setNext('')))}>
          Change it
        </button>
      </section>

      <section>
        <h4>Recovery question</h4>
        <p className="vault-note">
          {status.hasRecovery ? 'A recovery question is set. Changing it needs the master password.' : 'Without one, a forgotten master password cannot be recovered.'}
        </p>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What was your first phone?" />
        <input type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" autoComplete="off" />
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Master password" autoComplete="current-password" />
        <div className="vault-form-actions">
          <button type="button" className="queue-btn" disabled={busy || !current || !question.trim() || !answer} onClick={() => void onRecovery(current, { question, answer }).then((ok) => ok && (setQuestion(''), setAnswer('')))}>
            Save it
          </button>
          {status.hasRecovery && (
            <button type="button" className="queue-btn" disabled={busy || !current} onClick={() => void onRecovery(current, null)}>
              Remove it
            </button>
          )}
        </div>
      </section>

      <section>
        <h4>Lock by itself</h4>
        <div className="vault-locks">
          {AUTO_LOCK_CHOICES.map((ms) => (
            <button key={ms} type="button" className={`vault-lock${status.autoLockMs === ms ? ' on' : ''}`} disabled={busy || !current} onClick={() => void onAutoLock(current, ms)}>
              {saidAutoLock(ms)}
            </button>
          ))}
        </div>
        <p className="vault-note">Needs the master password, like everything else here.</p>
      </section>

      <section>
        <h4>Delete the vault</h4>
        <p className="vault-note">Everything in it goes, and none of it can be brought back.</p>
        {confirming ? (
          <div className="vault-form-actions">
            <button type="button" className="queue-btn danger" disabled={busy || !current} onClick={() => void onDestroy(current)}>
              Yes, delete it all
            </button>
            <button type="button" className="queue-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="queue-btn" disabled={busy || !current} onClick={() => setConfirming(true)}>
            Delete vault
          </button>
        )}
      </section>
    </div>
  )
}
