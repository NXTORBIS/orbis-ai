import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, LockOpen, ShieldAlert } from 'lucide-react'
import type { ProfileLockState } from '../../../shared/profileLockView'
import { isProfileLockRefusal } from '../../../shared/profileLockView'
import type { ProfileLockPolicy, ProfileLockPreset } from '../../../shared/profileLock'
import { PROFILE_LOCK_PRESETS } from '../../../shared/profileLock'
import { DELAY_CHOICES, describeDelay } from '../../../shared/tabLock'

/**
 * Profile Lock, in Settings.
 *
 * Orbis itself, behind the account password. Sits directly under the account password and above Tab Lock, because that is
 * the order the three layers are in: the account password opens the profile, the profile holds the tabs, and a tab
 * password is its own separate thing.
 *
 * Every control here does something. Where the operating system cannot support a trigger -- it cannot tell us how idle the
 * computer is -- the control is not shown at all rather than shown and quietly inert.
 */

const PRESET_SAYS: Record<ProfileLockPreset, string> = {
  standard: 'Locks when this computer locks or wakes, and after 15 minutes of nobody touching it.',
  strong: 'The same, after 5 minutes, and a minute after Orbis stops being the window in front.',
  'shared-computer': 'A computer other people use: away from the keyboard means locked.'
}

const same = (a: ProfileLockPolicy, b: ProfileLockPolicy): boolean =>
  a.enabled === b.enabled &&
  a.inactivity === b.inactivity &&
  a.onStart === b.onStart &&
  a.onResume === b.onResume &&
  a.onSystemLock === b.onSystemLock &&
  a.onBlur === b.onBlur &&
  a.onAllWindowsClosed === b.onAllWindowsClosed &&
  a.afterSystemUnlock === b.afterSystemUnlock

export default function ProfileLockSettings(): React.JSX.Element {
  const [state, setState] = useState<ProfileLockState | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')

  const read = useCallback(async () => {
    const said = await window.api.profileLockState()
    if (!isProfileLockRefusal(said)) setState(said)
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  // Orbis locking itself changes what this shows, so it follows rather than going stale.
  useEffect(() => window.api.onAccountLocked(() => void read()), [read])

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(''), 4000)
    return () => clearTimeout(timer)
  }, [done])

  const save = async (over: Partial<ProfileLockPolicy>, said = 'Saved.'): Promise<void> => {
    if (!state || busy) return
    setBusy(true)
    setProblem('')
    try {
      const answer = await window.api.profileLockSave({ ...state.policy, ...over })
      if (isProfileLockRefusal(answer)) {
        setProblem(answer.message ?? 'That did not work.')
        return
      }
      setState(answer.state)
      setDone(said)
    } finally {
      setBusy(false)
    }
  }

  const policy = state?.policy ?? null
  const preset = useMemo<ProfileLockPreset | null>(() => {
    if (!policy) return null
    for (const key of ['standard', 'strong', 'shared-computer'] as ProfileLockPreset[]) {
      if (same(PROFILE_LOCK_PRESETS[key], policy)) return key
    }
    return null
  }, [policy])

  return (
    <section className="setting tl">
      <div className="setting-label">
        <h3>Profile Lock</h3>
        <p>
          Puts Orbis away and asks for your account password. Different from Tab Lock, which hides one tab from somebody
          looking at the browser — this hides all of Orbis from whoever sits down at this computer next. Your tabs,
          history and everything else are kept exactly as they are.
        </p>
      </div>

      <div className="pw-panel">
        {state && !state.hasPassword ? (
          <p className="pw-state">
            <ShieldAlert size={15} />
            <span>Set an account password first. Without one there would be nothing to unlock Orbis with.</span>
          </p>
        ) : (
          <>
            <p className="pw-state">
              {policy?.enabled ? <Lock size={15} /> : <LockOpen size={15} />}
              <span>{policy?.enabled ? 'Orbis locks itself.' : 'Orbis does not lock itself.'}</span>
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

            <label className="tl-switch">
              <input
                type="checkbox"
                checked={policy?.enabled === true}
                disabled={busy}
                onChange={(e) => void save({ enabled: e.target.checked }, e.target.checked ? 'On.' : 'Off.')}
              />
              <span>Lock Orbis automatically</span>
            </label>

            {policy?.enabled && (
              <div className="tl-block">
                <h4>How strict</h4>
                <div className="tl-presets row">
                  {(['standard', 'strong', 'shared-computer'] as ProfileLockPreset[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`queue-btn small${preset === key ? ' is-on' : ''}`}
                      disabled={busy}
                      title={PRESET_SAYS[key]}
                      onClick={() => void save(PROFILE_LOCK_PRESETS[key])}
                    >
                      {key === 'standard' ? 'Standard' : key === 'strong' ? 'Strong' : 'Shared computer'}
                    </button>
                  ))}
                </div>

                <h4>When it locks</h4>

                {/* Only offered when the operating system can actually answer "how long has nobody touched this
                    computer". A control that quietly never fires is worse than no control. */}
                {state?.idleAvailable ? (
                  <label className="tl-delay">
                    <span>After nobody touches this computer</span>
                    <select
                      value={policy.inactivity === null ? 'never' : String(policy.inactivity)}
                      disabled={busy}
                      onChange={(e) =>
                        void save({ inactivity: e.target.value === 'never' ? null : Number(e.target.value) })
                      }
                    >
                      <option value="never">Never</option>
                      {DELAY_CHOICES.filter((ms) => ms >= 60_000).map((ms) => (
                        <option key={ms} value={ms}>
                          {describeDelay(ms)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="pw-note is-quiet">
                    This computer cannot tell Orbis how long it has been idle, so locking after inactivity is not
                    available here.
                  </p>
                )}

                <label className="tl-delay">
                  <span>After Orbis stops being the window in front</span>
                  <select
                    value={policy.onBlur === null ? 'never' : String(policy.onBlur)}
                    disabled={busy}
                    onChange={(e) => void save({ onBlur: e.target.value === 'never' ? null : Number(e.target.value) })}
                  >
                    <option value="never">Never</option>
                    {DELAY_CHOICES.map((ms) => (
                      <option key={ms} value={ms}>
                        {describeDelay(ms)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="tl-switch">
                  <input
                    type="checkbox"
                    checked={policy.onSystemLock}
                    disabled={busy}
                    onChange={(e) => void save({ onSystemLock: e.target.checked })}
                  />
                  <span>When this computer locks</span>
                </label>
                <label className="tl-switch">
                  <input
                    type="checkbox"
                    checked={policy.onResume}
                    disabled={busy}
                    onChange={(e) => void save({ onResume: e.target.checked })}
                  />
                  <span>When this computer wakes from sleep</span>
                </label>
                <label className="tl-switch">
                  <input
                    type="checkbox"
                    checked={policy.onStart}
                    disabled={busy}
                    onChange={(e) => void save({ onStart: e.target.checked })}
                  />
                  <span>When Orbis starts</span>
                </label>
                <label className="tl-switch">
                  <input
                    type="checkbox"
                    checked={policy.onAllWindowsClosed}
                    disabled={busy}
                    onChange={(e) => void save({ onAllWindowsClosed: e.target.checked })}
                  />
                  <span>When the last Orbis window closes</span>
                </label>

                <h4>When this computer is unlocked again</h4>
                <div className="tl-presets">
                  {(
                    [
                      ['stay-locked', 'Leave Orbis locked', 'Whatever locked it, it stays locked until you unlock it.'],
                      [
                        'require-password',
                        'Always ask for my password',
                        'Coming back to this computer always means typing your Orbis password.'
                      ],
                      [
                        'restore',
                        'Leave Orbis as it was',
                        'If Orbis was open before this computer locked, it is open again.'
                      ]
                    ] as const
                  ).map(([value, title, says]) => (
                    <label key={value} className={policy.afterSystemUnlock === value ? 'is-on' : undefined}>
                      <input
                        type="radio"
                        name="after-system-unlock"
                        checked={policy.afterSystemUnlock === value}
                        disabled={busy}
                        onChange={() => void save({ afterSystemUnlock: value })}
                      />
                      <b>{title}</b>
                      <span>{says}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* What the policy actually does, in sentences from the main process rather than worked out here -- so what
                is shown is what is in force, including the case where it is on and nothing triggers it. */}
            {state && state.explains.length > 0 && (
              <div className="tl-block">
                <h4>What happens now</h4>
                <ul className="tl-explains">
                  {state.explains.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="tl-block">
              <h4>Lock Orbis now</h4>
              <p className="pw-note is-quiet">
                Puts Orbis away straight away and asks for your account password. Every locked tab is locked too, and
                every tab password is closed. Nothing is closed and nothing is lost.
              </p>
              <button
                type="button"
                className="queue-btn small danger"
                disabled={busy}
                onClick={() => void window.api.profileLockNow()}
              >
                <Lock size={14} /> Lock Orbis
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
