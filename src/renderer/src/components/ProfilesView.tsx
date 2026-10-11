import { useEffect, useState } from 'react'
import { Check, Plus, Trash2, UserRound } from 'lucide-react'
import type { Profile } from '../../../shared/profiles'
import { DEFAULT_PROFILE_ID, PROFILE_COLORS } from '../../../shared/profiles'
import type { NoticeKind } from '../App'
import { Surface } from '../ui'

/**
 * Profiles: separate browsing identities. Each keeps its own cookies and logins, its own history, bookmarks and
 * downloads, and its own open pages. Extensions are installed once and follow whichever profile is in use.
 */
/**
 * Separate lives, separate data.
 *
 * A row in the feature dropdown before, which made "who is using Orbis" a place rather than a setting. It is a setting,
 * so it sits in Settings under Account, and `embedded` drops the overlay it used to wear.
 */
export default function ProfilesView({
  onClose,
  onNotify,
  embedded = false
}: {
  onClose?: () => void
  onNotify?: (message: string, kind?: NoticeKind) => void
  embedded?: boolean
}): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string>(DEFAULT_PROFILE_ID)
  const [name, setName] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  // Embedded in Settings there is no toast stack to reach, so one fallback rather than a `?.` at every call site.
  const say = onNotify ?? ((): void => undefined)

  const load = async (): Promise<void> => {
    const { profiles: list, activeId: current } = await window.api.listProfiles()
    setProfiles(list)
    setActiveId(current)
  }

  useEffect(() => {
    void load()
    const offs = [window.api.onProfilesChanged(() => void load()), window.api.onProfileChanged(() => void load())]
    return () => offs.forEach((off) => off())
  }, [])

  const create = async (): Promise<void> => {
    const chosen = name.trim()
    if (!chosen) return
    try {
      const made = await window.api.createProfile(chosen)
      setName('')
      say(`“${made.name}” is ready — switch to it when you want to use it`)
    } catch (err) {
      say(err instanceof Error ? err.message : 'That profile could not be made', 'error')
    }
  }

  const switchTo = async (profile: Profile): Promise<void> => {
    if (profile.id === activeId) return
    setSwitching(profile.id)
    try {
      await window.api.switchProfile(profile.id)
      say(`Now browsing as ${profile.name}`)
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not switch profile', 'error')
    } finally {
      setSwitching(null)
      void load()
    }
  }

  const remove = async (profile: Profile): Promise<void> => {
    const result = await window.api.removeProfile(profile.id)
    if (!result.removed) return say(result.reason ?? 'That profile cannot be deleted', 'error')
    say(`“${profile.name}” and everything it kept are gone`)
    void load()
  }

  // Adding a profile is the screen's own action, not something in the body: it sits in the header in both shapes.
  const adding = (
    <>
      <label className="spaces-save">
        <UserRound size={13} />
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} placeholder="New profile name" aria-label="Name for the new profile" />
      </label>
      <button type="button" className="queue-btn primary" disabled={!name.trim()} onClick={() => void create()}>
        <Plus size={14} /> Add profile
      </button>
    </>
  )

  const body = (
    <>
      <p className="profiles-note view-muted">
        Each profile keeps its own logins, cookies, history, bookmarks, downloads and open pages. Notes, tasks, boards and workflows are yours across all of them, and extensions are installed once and follow the profile you are using.
      </p>

      <div className="spaces-grid">
        {profiles.map((profile) => (
          <div key={profile.id} className={`space-card profile-card${profile.id === activeId ? ' current' : ''}`} style={{ borderTopColor: profile.color }}>
            <div className="space-head">
              <span className="profile-mark" style={{ background: profile.color }} aria-hidden="true">
                {profile.initial}
              </span>
              <input className="space-name" value={profile.name} aria-label={`Name of ${profile.name}`} onChange={(e) => void window.api.renameProfile(profile.id, e.target.value).then(load)} />
              {profile.id === activeId && (
                <span className="space-open">
                  <Check size={12} /> in use
                </span>
              )}
            </div>
            <p className="space-meta view-muted">
              {profile.id === DEFAULT_PROFILE_ID ? 'Your original browsing data' : `Made ${new Date(profile.createdAt).toLocaleDateString()}`}
              {profile.id !== activeId ? ` · last used ${new Date(profile.lastUsedAt).toLocaleDateString()}` : ''}
            </p>
            <div className="space-colors" role="group" aria-label="Colour">
              {PROFILE_COLORS.map((c) => (
                <button key={c} type="button" className={`board-color${profile.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => void window.api.saveProfile({ ...profile, color: c }).then(load)} />
              ))}
            </div>
            <div className="space-actions">
              <button type="button" className="queue-btn primary small" disabled={profile.id === activeId || switching === profile.id} onClick={() => void switchTo(profile)}>
                {profile.id === activeId ? 'In use' : switching === profile.id ? 'Switching…' : 'Switch to it'}
              </button>
              {profile.id !== DEFAULT_PROFILE_ID && (
                <button type="button" className="icon-btn danger" aria-label={`Delete ${profile.name}`} title={profile.id === activeId ? 'Switch to another profile first' : 'Delete this profile and everything it kept'} onClick={() => void remove(profile)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )

  // Embedded in Settings this is not a `.view` screen at all -- no positioning, no name of its own, no way out,
  // because the Settings frame around it has all three. And standalone with no `onClose` there is nothing for a
  // close button to call. Surface cannot keep its promises for either, so both keep the frame they were drawn with.
  if (embedded || !onClose) {
    return (
      <div className={embedded ? 'profiles-view is-embedded' : 'view profiles-view'} role="region" aria-label="Profiles">
        <header className="view-head">
          {!embedded && <h2>Profiles</h2>}
          <div className="view-actions">{adding}</div>
        </header>
        {body}
      </div>
    )
  }

  return (
    <Surface title="Profiles" actions={adding} onClose={onClose} closeLabel="Close profiles" className="profiles-view">
      {body}
    </Surface>
  )
}
