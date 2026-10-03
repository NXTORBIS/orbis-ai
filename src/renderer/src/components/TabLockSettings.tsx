import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Globe, KeyRound, Lock, LockOpen, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { TabLockGroup, TabLockState } from '../../../shared/tabLockView'
import { isTabLockRefusal } from '../../../shared/tabLockView'
import type { PresetName, TabLockPolicy } from '../../../shared/tabLock'
import { DELAY_CHOICES, cleanPattern, describeDelay, samePolicy } from '../../../shared/tabLock'
import { confirmPassword, judgePassword, PASSWORD_MAX, PASSWORD_MIN } from '../../../shared/passwordStrength'

/**
 * Tab Lock, in Settings.
 *
 * Four things, in the order somebody meets them: the tab passwords they have, what a locked tab does, which sites are
 * protected without being asked, and a way to lock everything at once.
 *
 * Nothing is decided here. Every password is judged by `shared/passwordStrength`, every policy by `shared/tabLock`, and
 * every credential by the main process. This asks, shows what came back, and keeps nothing afterwards -- which is why
 * each field is cleared the moment it has been used.
 */

interface Props {
  /** The person's name, so a password that is only their name is refused before it is sent anywhere. */
  userName: string
}

type Busy = '' | 'creating' | 'changing' | 'removing' | 'unlocking' | 'rule' | 'policy' | 'panic'

/** A sentence for whatever came back, including the one case where the answer is "wait". */
const refusalText = (said: { error: string; message?: string; waitMs?: number }): string => {
  if (said.error === 'cooling-down') {
    const seconds = Math.ceil((said.waitMs ?? 0) / 1000)
    return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
  }
  return said.message ?? 'That did not work.'
}

export default function TabLockSettings({ userName }: Props): React.JSX.Element {
  const [state, setState] = useState<TabLockState | null>(null)
  const [busy, setBusy] = useState<Busy>('')
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  const [shown, setShown] = useState(false)

  // Making one
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [preset, setPreset] = useState<PresetName>('standard')

  // Working on one that exists
  const [acting, setActing] = useState<{ groupId: string; what: 'open' | 'change' | 'reset' | 'remove' } | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  // A rule
  const [pattern, setPattern] = useState('')
  const [ruleGroup, setRuleGroup] = useState('')

  const read = useCallback(async () => {
    const said = await window.api.tabLockState()
    if (!isTabLockRefusal(said)) setState(said)
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  // A tab locking or unlocking changes what this shows, so it follows rather than going stale behind the person's back.
  useEffect(() => {
    const offChanged = window.api.onTabLockChanged(() => void read())
    const offSwept = window.api.onTabLockSwept(() => void read())
    return () => {
      offChanged()
      offSwept()
    }
  }, [read])

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(''), 4000)
    return () => clearTimeout(timer)
  }, [done])

  /** Everything typed, forgotten. After success, after cancelling, and after an error. */
  const clear = (): void => {
    setName('')
    setPassword('')
    setAgain('')
    setCurrent('')
    setNext('')
    setShown(false)
  }

  /** One way of running any of these, so the refusal, the clearing and the fresh state are handled once. */
  const run = async (
    label: Busy,
    call: () => Promise<unknown>,
    said: string
  ): Promise<boolean> => {
    if (busy) return false
    setBusy(label)
    setProblem('')
    try {
      const answer = (await call()) as { error?: string; message?: string; waitMs?: number; state?: TabLockState }
      if (answer && isTabLockRefusal(answer)) {
        setProblem(refusalText(answer))
        return false
      }
      if (answer?.state) setState(answer.state)
      else await read()
      clear()
      setDone(said)
      return true
    } finally {
      setBusy('')
    }
  }

  const groups = state?.groups ?? []
  const strength = judgePassword(password, userName)
  const match = confirmPassword(password, again)
  const canCreate = name.trim().length > 0 && strength.ok && match.ok

  const tabsByGroup = useMemo(() => {
    const counted = new Map<string, { total: number; locked: number }>()
    for (const tab of state?.tabs ?? []) {
      const row = counted.get(tab.groupId) ?? { total: 0, locked: 0 }
      row.total++
      if (tab.locked) row.locked++
      counted.set(tab.groupId, row)
    }
    return counted
  }, [state])

  const reveal = (
    <button
      type="button"
      className="pw-reveal"
      aria-label={shown ? 'Hide passwords' : 'Show passwords'}
      onClick={() => setShown((was) => !was)}
    >
      {shown ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  )

  // ---------------------------------------------------------------- what a locked tab does

  const defaultPolicy = state?.defaultPolicy ?? null
  const matchedPreset = useMemo<PresetName | null>(() => {
    if (!state || !defaultPolicy) return null
    for (const key of ['standard', 'strong', 'maximum'] as PresetName[]) {
      if (samePolicy(state.presets[key], defaultPolicy)) return key
    }
    return null
  }, [state, defaultPolicy])

  const setPolicyField = (field: keyof TabLockPolicy, value: number | null | boolean): void => {
    if (!defaultPolicy) return
    void run('policy', () => window.api.tabLockSetDefaultPolicy({ ...defaultPolicy, [field]: value }), 'Saved.')
  }

  return (
    <section className="setting tl">
      <div className="setting-label">
        <h3>Tab Lock</h3>
        <p>
          A tab password hides the tabs it covers completely: no title, no address, no icon, no preview, and nothing
          Orion or an automation can read. Your account password is the only way back into one you forget.
        </p>
      </div>

      <div className="pw-panel">
        <p className="pw-state">
          {groups.some((g) => g.open) ? <LockOpen size={15} /> : <Lock size={15} />}
          <span>
            {groups.length === 0
              ? 'No tab passwords yet.'
              : `${groups.length} tab password${groups.length === 1 ? '' : 's'}, ${groups.filter((g) => g.open).length} open.`}
          </span>
          {done && (
            <span className="pw-done" role="status">
              {done}
            </span>
          )}
        </p>

        {problem && (
          <p className="pw-note" role="alert">
            {problem}
          </p>
        )}

        {/* ---------------------------------------------------------------- the passwords themselves */}

        {groups.length > 0 && (
          <ul className="tl-groups">
            {groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                counts={tabsByGroup.get(group.id) ?? { total: 0, locked: 0 }}
                acting={acting?.groupId === group.id ? acting.what : null}
                busy={busy}
                shown={shown}
                reveal={reveal}
                current={current}
                next={next}
                strengthOk={judgePassword(next, userName).ok}
                onAct={(what) => {
                  clear()
                  setProblem('')
                  setActing(what === null ? null : { groupId: group.id, what })
                }}
                onCurrent={setCurrent}
                onNext={setNext}
                onOpen={() =>
                  void run('unlocking', () => window.api.tabLockUnlockGroup(group.id, current), `"${group.name}" is open.`).then(
                    (ok) => ok && setActing(null)
                  )
                }
                onChange={() =>
                  void run('changing', () => window.api.tabLockChangeGroupPassword(group.id, current, next), 'Password changed.').then(
                    (ok) => ok && setActing(null)
                  )
                }
                onReset={() =>
                  void run('changing', () => window.api.tabLockResetGroupPassword(group.id, current, next), 'Password reset.').then(
                    (ok) => ok && setActing(null)
                  )
                }
                onRemove={() =>
                  void run('removing', () => window.api.tabLockRemoveGroup(group.id, current), `"${group.name}" removed.`).then(
                    (ok) => ok && setActing(null)
                  )
                }
              />
            ))}
          </ul>
        )}

        {!adding ? (
          <button
            type="button"
            className="queue-btn small"
            onClick={() => {
              clear()
              setProblem('')
              setAdding(true)
            }}
          >
            <Plus size={14} /> New tab password
          </button>
        ) : (
          <form
            className="pw-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!canCreate) return
              void run(
                'creating',
                () => window.api.tabLockCreateGroup(name.trim(), password, state?.presets[preset]),
                `"${name.trim()}" is ready.`
              ).then((ok) => ok && setAdding(false))
            }}
          >
            <label className="pw-row">
              <span>What is it for</span>
              <span className="pw-field">
                <input
                  value={name}
                  maxLength={60}
                  placeholder="Banking"
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </span>
            </label>

            <label className="pw-row">
              <span>Password</span>
              <span className="pw-field has-reveal">
                <input
                  type={shown ? 'text' : 'password'}
                  value={password}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  aria-invalid={password.length >= PASSWORD_MIN && !strength.ok}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {reveal}
              </span>
            </label>

            <div className="pw-meter" aria-hidden="true" data-strength={password ? strength.strength : 'none'}>
              <span style={{ width: `${(strength.score / 4) * 100}%` }} />
            </div>
            <p className="pw-note" role={strength.problem ? 'alert' : undefined}>
              {password.length >= PASSWORD_MIN && strength.problem
                ? strength.problem
                : password && strength.ok
                  ? `${strength.strength[0].toUpperCase()}${strength.strength.slice(1)}. ${strength.advice}`.trim()
                  : `At least ${PASSWORD_MIN} characters. Not the same as your account password.`}
            </p>

            <label className="pw-row">
              <span>Confirm</span>
              <span className="pw-field">
                <input
                  type={shown ? 'text' : 'password'}
                  value={again}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  aria-invalid={again.length >= password.length && Boolean(match.problem)}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </span>
            </label>
            <p className="pw-note">{again ? match.problem : ''}</p>

            <fieldset className="tl-presets">
              <legend>How strict</legend>
              {(['standard', 'strong', 'maximum'] as PresetName[]).map((key) => (
                <label key={key} className={preset === key ? 'is-on' : undefined}>
                  <input type="radio" name="tl-preset" checked={preset === key} onChange={() => setPreset(key)} />
                  <b>{key === 'standard' ? 'Standard' : key === 'strong' ? 'Strong' : 'Maximum'}</b>
                  <span>
                    {key === 'standard'
                      ? 'Locks when this computer locks or sleeps, and after 15 minutes of nothing.'
                      : key === 'strong'
                        ? 'Also locks half a minute after Orbis loses focus, and the moment it is minimised.'
                        : 'Locks the instant you look away from it.'}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="tl-actions">
              <button type="submit" className="queue-btn small" disabled={!canCreate || busy === 'creating'}>
                {busy === 'creating' ? 'Making it…' : 'Create'}
              </button>
              <button
                type="button"
                className="queue-btn small ghost"
                onClick={() => {
                  clear()
                  setAdding(false)
                  setProblem('')
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ---------------------------------------------------------------- what a locked tab does */}

        {defaultPolicy && (
          <div className="tl-block">
            <h4>When a tab locks</h4>
            <p className="pw-note is-quiet">
              What a newly protected tab does. A single tab password can be set differently, and a single tab can be set
              differently again.
            </p>

            <div className="tl-presets row">
              {(['standard', 'strong', 'maximum'] as PresetName[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`queue-btn small${matchedPreset === key ? ' is-on' : ''}`}
                  disabled={busy === 'policy'}
                  onClick={() =>
                    void run('policy', () => window.api.tabLockSetDefaultPolicy(state!.presets[key]), 'Saved.')
                  }
                >
                  {key === 'standard' ? 'Standard' : key === 'strong' ? 'Strong' : 'Maximum'}
                </button>
              ))}
            </div>

            <DelayRow
              label="After you leave the tab"
              value={defaultPolicy.tabSwitch}
              onChange={(value) => setPolicyField('tabSwitch', value)}
            />
            <DelayRow
              label="After Orbis loses focus"
              value={defaultPolicy.windowBlur}
              onChange={(value) => setPolicyField('windowBlur', value)}
            />
            <DelayRow
              label="After nothing happens in it"
              value={defaultPolicy.inactivity}
              onChange={(value) => setPolicyField('inactivity', value)}
            />
            <DelayRow
              label="After Orbis is minimised"
              value={defaultPolicy.minimize}
              onChange={(value) => setPolicyField('minimize', value)}
            />

            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.onSystemLock}
                onChange={(e) => setPolicyField('onSystemLock', e.target.checked)}
              />
              <span>When this computer locks</span>
            </label>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.onSleep}
                onChange={(e) => setPolicyField('onSleep', e.target.checked)}
              />
              <span>When this computer sleeps</span>
            </label>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.onStartup}
                onChange={(e) => setPolicyField('onStartup', e.target.checked)}
              />
              <span>When Orbis starts</span>
            </label>

            <h4>What a locked tab shows</h4>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.hideTitle}
                onChange={(e) => setPolicyField('hideTitle', e.target.checked)}
              />
              <span>Hide its title</span>
            </label>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.hideUrl}
                onChange={(e) => setPolicyField('hideUrl', e.target.checked)}
              />
              <span>Hide its address</span>
            </label>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.hideFavicon}
                onChange={(e) => setPolicyField('hideFavicon', e.target.checked)}
              />
              <span>Hide the site&apos;s icon</span>
            </label>
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.hidePreview}
                onChange={(e) => setPolicyField('hidePreview', e.target.checked)}
              />
              <span>No preview or thumbnail</span>
            </label>
            {/* Not a choice about whether Orion may read a locked tab -- it never may. It is about whether a protected but
                open tab is kept out of Orion's reach as well. */}
            <label className="tl-switch">
              <input
                type="checkbox"
                checked={defaultPolicy.hideFromAi}
                onChange={(e) => setPolicyField('hideFromAi', e.target.checked)}
              />
              <span>Keep it from Orion even while it is open</span>
            </label>

            <label className="pw-row">
              <span>What a locked tab is called instead</span>
              <span className="pw-field">
                <input
                  value={defaultPolicy.label}
                  maxLength={40}
                  onChange={(e) =>
                    void run('policy', () => window.api.tabLockSetDefaultPolicy({ ...defaultPolicy, label: e.target.value }), 'Saved.')
                  }
                />
              </span>
            </label>
          </div>
        )}

        {/* ---------------------------------------------------------------- rules */}

        {groups.length > 0 && (
          <div className="tl-block">
            <h4>Sites protected automatically</h4>
            <p className="pw-note is-quiet">
              A site here is protected the moment it opens, without being asked. Write a host, optionally with{' '}
              <code>*.</code> in front for its subdomains and a path after it. Not a pattern language: a mistake here
              should protect too little, never everything.
            </p>

            {(state?.rules.length ?? 0) > 0 && (
              <ul className="tl-rules">
                {state!.rules.map((rule) => (
                  <li key={rule.id}>
                    <Globe size={14} />
                    <code>{rule.pattern}</code>
                    <span>{groups.find((g) => g.id === rule.groupId)?.name ?? 'a password that is gone'}</span>
                    <button
                      type="button"
                      className="tl-icon"
                      aria-label={`Stop protecting ${rule.pattern}`}
                      disabled={busy === 'rule'}
                      onClick={() => void run('rule', () => window.api.tabLockRemoveRule(rule.id), 'Rule removed.')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="tl-rule-add"
              onSubmit={(e) => {
                e.preventDefault()
                const clean = cleanPattern(pattern)
                if (!clean) {
                  setProblem('That is not a site Orbis can match. Try something like bank.example.')
                  return
                }
                const group = ruleGroup || groups[0]?.id
                if (!group) return
                void run('rule', () => window.api.tabLockAddRule({ pattern: clean, groupId: group, enabled: true }), 'Rule added.').then(
                  (ok) => ok && setPattern('')
                )
              }}
            >
              <input
                value={pattern}
                maxLength={200}
                aria-label="Which addresses this rule covers" placeholder="*.bank.example"
                onChange={(e) => setPattern(e.target.value)}
              />
              <select value={ruleGroup || groups[0]?.id} onChange={(e) => setRuleGroup(e.target.value)}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="queue-btn small" disabled={busy === 'rule' || !pattern.trim()}>
                Add
              </button>
            </form>
          </div>
        )}

        {/* ---------------------------------------------------------------- everything at once */}

        {groups.length > 0 && (
          <div className="tl-block">
            <h4>Lock everything now</h4>
            <p className="pw-note is-quiet">
              Locks every protected tab and closes every tab password, so nothing reopens without being typed again.
            </p>
            <button
              type="button"
              className="queue-btn small danger"
              disabled={busy === 'panic'}
              onClick={() =>
                void run('panic', () => window.api.tabLockLockAll(), 'Everything is locked.')
              }
            >
              <Lock size={14} /> Lock everything
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- one tab password

interface GroupRowProps {
  group: TabLockGroup
  counts: { total: number; locked: number }
  acting: 'open' | 'change' | 'reset' | 'remove' | null
  busy: Busy
  shown: boolean
  reveal: React.JSX.Element
  current: string
  next: string
  strengthOk: boolean
  onAct(what: 'open' | 'change' | 'reset' | 'remove' | null): void
  onCurrent(value: string): void
  onNext(value: string): void
  onOpen(): void
  onChange(): void
  onReset(): void
  onRemove(): void
}

function GroupRow(p: GroupRowProps): React.JSX.Element {
  const { group, counts, acting } = p
  const needsNew = acting === 'change' || acting === 'reset'

  return (
    <li className="tl-group">
      <div className="tl-group-head">
        {group.open ? <LockOpen size={15} /> : <Lock size={15} />}
        <b>{group.name}</b>
        <span className="tl-meta">
          {counts.total === 0
            ? 'No tabs'
            : `${counts.total} tab${counts.total === 1 ? '' : 's'}${counts.locked ? `, ${counts.locked} locked` : ''}`}
          {group.open ? ' · open' : ''}
          {/* Said plainly. A password made while the account was closed genuinely cannot be reset, and letting somebody
              believe otherwise is the kind of thing they find out at the worst moment. */}
          {group.recoverable ? '' : ' · your account password cannot reset this one'}
        </span>
        <div className="tl-group-buttons">
          {!group.open && (
            <button type="button" className="queue-btn tiny" onClick={() => p.onAct(acting === 'open' ? null : 'open')}>
              Open
            </button>
          )}
          <button type="button" className="queue-btn tiny" onClick={() => p.onAct(acting === 'change' ? null : 'change')}>
            <KeyRound size={13} /> Change
          </button>
          {group.recoverable && (
            <button type="button" className="queue-btn tiny" onClick={() => p.onAct(acting === 'reset' ? null : 'reset')}>
              <ShieldCheck size={13} /> Forgot it
            </button>
          )}
          <button
            type="button"
            className="queue-btn tiny danger"
            onClick={() => p.onAct(acting === 'remove' ? null : 'remove')}
          >
            <Trash2 size={13} /> Remove
          </button>
        </div>
      </div>

      {acting && (
        <form
          className="pw-form inner"
          onSubmit={(e) => {
            e.preventDefault()
            if (acting === 'open') p.onOpen()
            else if (acting === 'change') p.onChange()
            else if (acting === 'reset') p.onReset()
            else p.onRemove()
          }}
        >
          <label className="pw-row">
            <span>
              {acting === 'reset'
                ? 'Your account password'
                : acting === 'remove'
                  ? `The password for "${group.name}"`
                  : acting === 'open'
                    ? 'Password'
                    : 'Current password'}
            </span>
            <span className="pw-field has-reveal">
              <input
                type={p.shown ? 'text' : 'password'}
                value={p.current}
                maxLength={PASSWORD_MAX}
                autoComplete="current-password"
                autoFocus
                onChange={(e) => p.onCurrent(e.target.value)}
              />
              {p.reveal}
            </span>
          </label>

          {needsNew && (
            <label className="pw-row">
              <span>New password</span>
              <span className="pw-field">
                <input
                  type={p.shown ? 'text' : 'password'}
                  value={p.next}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  onChange={(e) => p.onNext(e.target.value)}
                />
              </span>
            </label>
          )}

          {acting === 'remove' && (
            <p className="pw-note" role="alert">
              The tabs it covers stop being protected. Nothing is closed and nothing is deleted.
            </p>
          )}

          <div className="tl-actions">
            <button
              type="submit"
              className={`queue-btn small${acting === 'remove' ? ' danger' : ''}`}
              disabled={Boolean(p.busy) || p.current.length === 0 || (needsNew && !p.strengthOk)}
            >
              {acting === 'open' ? 'Open' : acting === 'remove' ? 'Remove' : 'Save'}
            </button>
            <button type="button" className="queue-btn small ghost" onClick={() => p.onAct(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

// ---------------------------------------------------------------- a delay

function DelayRow({
  label,
  value,
  onChange
}: {
  label: string
  value: number | null
  onChange(value: number | null): void
}): React.JSX.Element {
  return (
    <label className="tl-delay">
      <span>{label}</span>
      <select
        value={value === null ? 'never' : String(value)}
        onChange={(e) => onChange(e.target.value === 'never' ? null : Number(e.target.value))}
      >
        <option value="never">Never</option>
        {DELAY_CHOICES.map((ms) => (
          <option key={ms} value={ms}>
            {describeDelay(ms)}
          </option>
        ))}
      </select>
    </label>
  )
}
