import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Lock, Play, Settings2, Sparkles, X } from 'lucide-react'
import type { Catalogue, Call } from './useStudent'
import type { ContentCategory, FocusLevel, SessionRecommendation, StudentSnapshot } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Starting a session.
 *
 * Two doors, and which one somebody uses is the whole design of this screen. **Quick Start** is one press on a
 * session Orbis worked out from what they actually finish. **Customise** is everything, and it is behind a press,
 * because a student who has to make nine decisions before they can begin will go and do something else instead.
 *
 * Before a locked session there is a preview, listing what will be held back and what will stay open. Nothing about
 * entering Deep Focus should be a surprise -- a student who finds out mid-session that their notes site is blocked
 * does not trust the feature again.
 */

interface Draft {
  title: string
  subject: string
  taskId: string | null
  goalId: string | null
  intention: string
  oneThing: string
  minutes: number
  level: FocusLevel
  breaks: { focusMinutes: number; breakMinutes: number; blocks: number; autoResume: boolean }
  atmosphere: string | null
  playlistId: string | null
  capsuleId: string | null
  blocked: ContentCategory[]
  approved: string[]
  locked: boolean
  youtube: 'blocked' | 'educational' | 'approved-only' | 'open'
}

const CATEGORIES: ContentCategory[] = ['social', 'entertainment', 'streaming', 'gaming', 'shopping', 'news', 'communication', 'unknown']

export default function FocusStart({
  snapshot,
  catalogue,
  call,
  onClose,
  onStarted,
  onNotify
}: {
  snapshot: StudentSnapshot
  catalogue: Catalogue | null
  call: Call
  onClose(): void
  onStarted(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const prefs = snapshot.preferences
  const recommendation: SessionRecommendation | null = snapshot.recommendation
  const [mode, setMode] = useState<'quick' | 'custom'>('quick')
  const [capsules, setCapsules] = useState<{ id: string; name: string; minutes: number; level: FocusLevel; subject: string | null; favourite: boolean; used: number; completed: number }[]>([])
  const [preview, setPreview] = useState<{ blocked: readonly string[]; allowed: readonly string[]; locked: boolean; note: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  const [draft, setDraft] = useState<Draft>({
    title: '',
    subject: recommendation?.subject ?? '',
    taskId: recommendation?.taskId ?? null,
    goalId: null,
    intention: '',
    oneThing: '',
    minutes: recommendation?.minutes ?? prefs.defaultMinutes,
    level: recommendation?.level ?? prefs.defaultLevel,
    breaks: prefs.defaultBreaks,
    atmosphere: recommendation?.atmosphere ?? prefs.defaultAtmosphere,
    playlistId: prefs.musicOnFocus === 'off' ? null : prefs.defaultPlaylistId,
    capsuleId: recommendation?.capsuleId ?? null,
    blocked: [...prefs.blockedCategories],
    approved: [...prefs.approvedSites],
    locked: (recommendation?.level ?? prefs.defaultLevel) === 'deep',
    youtube: prefs.youtube
  })

  useEffect(() => {
    void call<typeof capsules>('capsules').then((list) => setCapsules(Array.isArray(list) ? list : []))
  }, [call])

  // The preview follows the policy, so it is never out of date with what is about to happen.
  useEffect(() => {
    void call<typeof preview>('preview-policy', draft.level, { blocked: draft.blocked, approved: draft.approved, locked: draft.locked, youtube: draft.youtube }).then((one) => setPreview(one ?? null))
  }, [call, draft.level, draft.blocked, draft.approved, draft.locked, draft.youtube])

  const task = useMemo(() => snapshot.queue.find((one) => one.id === draft.taskId) ?? null, [snapshot.queue, draft.taskId])

  const start = async (over: Partial<Draft> = {}): Promise<void> => {
    const one = { ...draft, ...over }
    setStarting(true)
    const out = await call<{ ok: boolean; why?: string }>('start-focus', {
      title: one.title || task?.title || one.subject || 'Focus',
      subject: one.subject || null,
      taskId: one.taskId,
      goalId: one.goalId,
      intention: one.intention,
      oneThing: one.oneThing || task?.title || '',
      minutes: one.minutes,
      breaks: one.breaks,
      atmosphere: one.atmosphere,
      playlistId: one.playlistId,
      capsuleId: one.capsuleId,
      policy: { level: one.level, blocked: one.blocked, approved: one.approved, locked: one.locked, youtube: one.youtube }
    })
    setStarting(false)
    if (!out?.ok) {
      onNotify(out?.why ?? 'That session could not be started.', 'warn')
      return
    }
    onStarted()
  }

  const startCapsule = async (id: string): Promise<void> => {
    const capsule = capsules.find((one) => one.id === id)
    if (!capsule) return
    setStarting(true)
    const out = await call<{ ok: boolean; why?: string }>('start-focus', { capsuleId: id, title: capsule.name, subject: capsule.subject, minutes: capsule.minutes, policy: { level: capsule.level } })
    setStarting(false)
    if (!out?.ok) {
      onNotify(out?.why ?? 'That capsule could not be started.', 'warn')
      return
    }
    onStarted()
  }

  const level = catalogue?.levels[draft.level]
  const needsPreview = draft.level === 'deep' || draft.locked

  return (
    <div className="st-start" data-tour="focus-start">
      <header className="st-start-head">
        <div>
          <h2>Start Focus</h2>
          <p>{mode === 'quick' ? 'One press, or set it up exactly.' : 'Everything about this session.'}</p>
        </div>
        <div className="st-start-modes" data-tour="focus-level">
          <button type="button" className={`st-tab${mode === 'quick' ? ' on' : ''}`} aria-pressed={mode === 'quick'} onClick={() => setMode('quick')}>
            Quick start
          </button>
          <button type="button" className={`st-tab${mode === 'custom' ? ' on' : ''}`} aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>
            <Settings2 size={14} aria-hidden /> Customise
          </button>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      {mode === 'quick' ? (
        <div className="st-start-quick">
          {recommendation ? (
            <button type="button" className="st-recommend" disabled={starting} onClick={() => void start({ minutes: recommendation.minutes, level: recommendation.level, locked: recommendation.level === 'deep' })}>
              <span className="st-recommend-tag">
                <Sparkles size={13} aria-hidden /> Suggested
              </span>
              <strong>
                {recommendation.subject ? `${recommendation.subject} · ` : ''}
                {recommendation.minutes} minutes
              </strong>
              <span className="st-recommend-level">{catalogue?.levels[recommendation.level]?.label ?? recommendation.level}</span>
              {/* Said in the student's own history, never as a claim about them. */}
              <span className="st-recommend-why">{recommendation.because}</span>
              <span className="st-recommend-go">
                <Play size={16} aria-hidden /> Start
              </span>
            </button>
          ) : null}

          {task ? (
            <p className="st-start-task">
              First in your queue: <strong>{task.title}</strong>
            </p>
          ) : null}

          <h3>Presets</h3>
          <div className="st-preset-grid">
            {(catalogue?.presets ?? []).map((one) => (
              <button key={one.id} type="button" className="st-preset" disabled={starting} onClick={() => void start({ minutes: one.minutes, level: one.level, breaks: one.breaks, locked: one.level === 'deep', title: one.label })}>
                <strong>{one.label}</strong>
                <span className="st-preset-meta">
                  {one.minutes}m · {catalogue?.levels[one.level]?.label ?? one.level}
                </span>
                <span className="st-preset-blurb">{one.blurb}</span>
              </button>
            ))}
          </div>

          {capsules.length > 0 ? (
            <>
              <h3>Your capsules</h3>
              <div className="st-capsule-row">
                {[...capsules]
                  .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.used - a.used)
                  .slice(0, 8)
                  .map((one) => (
                    <button key={one.id} type="button" className="st-capsule" disabled={starting} onClick={() => void startCapsule(one.id)}>
                      <strong>{one.name}</strong>
                      <span>
                        {one.minutes}m · {catalogue?.levels[one.level]?.label ?? one.level}
                      </span>
                      {one.used > 0 ? (
                        <span className="st-faint">
                          {one.completed} of {one.used} finished
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="st-start-custom">
          <div className="st-row">
            <label className="st-field">
              <span>What are you working on?</span>
              <input value={draft.title} onChange={(e) => setDraft((h) => ({ ...h, title: e.target.value.slice(0, 200) }))} placeholder={task?.title ?? 'Kinematics'} />
            </label>
            <label className="st-field">
              <span>Subject</span>
              <input value={draft.subject} onChange={(e) => setDraft((h) => ({ ...h, subject: e.target.value.slice(0, 80) }))} placeholder="Physics" list="st-subjects" />
            </label>
          </div>

          {snapshot.queue.length > 0 ? (
            <label className="st-field">
              <span>Task</span>
              <select value={draft.taskId ?? ''} onChange={(e) => setDraft((h) => ({ ...h, taskId: e.target.value || null }))}>
                <option value="">Not linked to a task</option>
                {snapshot.queue.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.title}
                    {one.subject ? ` — ${one.subject}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="st-row">
            <label className="st-field">
              <span>How long</span>
              <div className="st-minutes">
                <input type="range" min={5} max={180} step={5} value={draft.minutes} onChange={(e) => setDraft((h) => ({ ...h, minutes: Number(e.target.value) }))} aria-label="Minutes" />
                <strong>{draft.minutes}m</strong>
              </div>
            </label>
            <label className="st-field">
              <span>Breaks</span>
              <select
                value={`${draft.breaks.focusMinutes}/${draft.breaks.breakMinutes}`}
                onChange={(e) => {
                  const found = Object.values(catalogue?.pomodoro ?? {}).find((one) => `${one.plan.focusMinutes}/${one.plan.breakMinutes}` === e.target.value)
                  if (found) setDraft((h) => ({ ...h, breaks: found.plan }))
                }}
              >
                {Object.entries(catalogue?.pomodoro ?? {}).map(([id, one]) => (
                  <option key={id} value={`${one.plan.focusMinutes}/${one.plan.breakMinutes}`}>
                    {one.label}
                    {one.plan.breakMinutes > 0 ? ` — ${one.plan.focusMinutes}/${one.plan.breakMinutes}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="st-field">
            <legend>How strict</legend>
            <div className="st-choices tight">
              {(['light', 'focus', 'deep'] as FocusLevel[]).map((one) => (
                <button
                  key={one}
                  type="button"
                  className={`st-choice${draft.level === one ? ' on' : ''}`}
                  aria-pressed={draft.level === one}
                  onClick={() => setDraft((h) => ({ ...h, level: one, locked: one === 'deep', blocked: [...((catalogue?.levels[one]?.blocked ?? h.blocked) as ContentCategory[])] }))}
                >
                  <strong>{catalogue?.levels[one]?.label ?? one}</strong>
                  <span>{catalogue?.levels[one]?.blurb ?? ''}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="st-field">
            <span>Why does this session matter?</span>
            <input value={draft.intention} onChange={(e) => setDraft((h) => ({ ...h, intention: e.target.value.slice(0, 400) }))} placeholder="Finish Kinematics before tomorrow" />
            <small>Shown back to you only if you try to leave early.</small>
          </label>

          <label className="st-field">
            <span>The one thing that must get done</span>
            <input value={draft.oneThing} onChange={(e) => setDraft((h) => ({ ...h, oneThing: e.target.value.slice(0, 200) }))} placeholder={task?.title ?? 'Projectile motion problems'} />
          </label>

          <div className="st-row">
            <label className="st-field">
              <span>Atmosphere</span>
              <select value={draft.atmosphere ?? ''} onChange={(e) => setDraft((h) => ({ ...h, atmosphere: e.target.value || null }))}>
                <option value="">None</option>
                {(catalogue?.atmospheres ?? []).map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="st-field">
              <span>Music</span>
              <select value={draft.playlistId ?? ''} onChange={(e) => setDraft((h) => ({ ...h, playlistId: e.target.value || null }))}>
                <option value="">Don&apos;t start music</option>
                <option value="__study">Your study playlist</option>
              </select>
              <small>Nothing plays until you start the session.</small>
            </label>
          </div>

          <button type="button" className="st-disclose" aria-expanded={advanced} onClick={() => setAdvanced((one) => !one)}>
            <ChevronDown size={15} aria-hidden className={advanced ? 'open' : ''} /> Customise Focus policy
          </button>

          {advanced ? (
            <div className="st-advanced">
              <fieldset className="st-field">
                <legend>Held back during this session</legend>
                <div className="st-pills">
                  {CATEGORIES.map((one) => {
                    const on = draft.blocked.includes(one)
                    return (
                      <button
                        key={one}
                        type="button"
                        className={`st-pill${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => setDraft((h) => ({ ...h, blocked: on ? h.blocked.filter((x) => x !== one) : [...h.blocked, one] }))}
                      >
                        {catalogue?.categories[one] ?? one}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <label className="st-field">
                <span>Video</span>
                <select value={draft.youtube} onChange={(e) => setDraft((h) => ({ ...h, youtube: e.target.value as Draft['youtube'] }))}>
                  <option value="open">Open as usual</option>
                  <option value="educational">Feeds held back, a video you go to directly opens</option>
                  <option value="approved-only">Only videos you approved</option>
                  <option value="blocked">Held back entirely</option>
                </select>
              </label>
              <label className="st-field">
                <span>Always allowed in this session</span>
                <textarea
                  value={draft.approved.join('\n')}
                  onChange={(e) => setDraft((h) => ({ ...h, approved: e.target.value.split('\n').map((one) => one.trim()).filter(Boolean).slice(0, 400) }))}
                  rows={4}
                  placeholder={'ncert.nic.in\ndocs.python.org\nexample.com/chapter-3'}
                />
                <small>One per line. A site, or an address to allow everything under.</small>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={draft.locked} onChange={(e) => setDraft((h) => ({ ...h, locked: e.target.checked }))} />
                <span>
                  <strong>Focus Lock</strong>
                  <small>The policy is fixed for the session, and leaving takes a deliberate press. You can always close Orbis.</small>
                </span>
              </label>
            </div>
          ) : null}

          {needsPreview && preview ? (
            <div className="st-preview">
              <h4>
                <Lock size={14} aria-hidden /> During this session
              </h4>
              <div className="st-preview-cols">
                <div>
                  <h5>Held back</h5>
                  <ul>
                    {preview.blocked.map((one) => (
                      <li key={one}>{one}</li>
                    ))}
                    {preview.blocked.length === 0 ? <li className="st-faint">Nothing</li> : null}
                  </ul>
                </div>
                <div>
                  <h5>Open</h5>
                  <ul>
                    {preview.allowed.slice(0, 10).map((one) => (
                      <li key={one}>{one}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="st-faint">{preview.note}</p>
            </div>
          ) : null}

          <div className="st-start-foot">
            <span className="st-faint">
              {draft.minutes} minutes · {level?.label ?? draft.level}
              {draft.locked ? ' · locked' : ''}
            </span>
            <button type="button" className="st-btn primary big" disabled={starting} onClick={() => void start()}>
              <Play size={16} aria-hidden /> Start Focus
            </button>
          </div>
        </div>
      )}

      <datalist id="st-subjects">
        {[...new Set(snapshot.queue.map((one) => one.subject).filter((one): one is string => !!one))].map((one) => (
          <option key={one} value={one} />
        ))}
      </datalist>
    </div>
  )
}
