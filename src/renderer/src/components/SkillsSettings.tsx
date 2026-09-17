import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkillSettings, SkillView } from '../../../shared/skills'
import { Segmented, Toggle } from './SettingsModal'

const HEALTH: Record<SkillView['health'], string> = {
  verified: 'Working',
  'needs-review': 'Needs a look',
  unstable: 'Keeps failing',
  disabled: 'Off'
}

const REUSE: [SkillSettings['reuse'], string][] = [
  ['never', 'Never'],
  ['suggest', 'Suggest'],
  ['auto', 'Use automatically']
]

const said = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.')

function when(ms?: number): string {
  if (!ms) return 'never'
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/**
 * Settings → Learned skills: whether Orion uses and learns skills, and the skills this profile has kept.
 *
 * Every number shown comes from the skill's real runs. Nothing here runs a skill; switching one on, deleting it or
 * going back to an earlier version is always the person's own click.
 */
export default function SkillsSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<SkillSettings | null>(null)
  const [skills, setSkills] = useState<SkillView[]>([])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    void window.api.skillSettings().then(setSettings)
    void window.api.listSkills().then(setSkills)
  }, [])
  useEffect(() => {
    refresh()
    return window.api.onSkillsChanged(refresh)
  }, [refresh])

  const act = async (work: () => Promise<unknown>, done?: string): Promise<void> => {
    setMessage('')
    try {
      await work()
      if (done) setMessage(done)
    } catch (err) {
      setMessage(said(err))
    }
    refresh()
  }

  const update = (next: Partial<SkillSettings>): void => void act(() => window.api.setSkillSettings(next))

  const exportOne = (skill: SkillView): void =>
    void act(async () => {
      const json = await window.api.exportSkill(skill.workflow.id)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${skill.workflow.name.replace(/[^\w -]+/g, '').trim() || 'skill'}.orbis-skill.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })

  const importFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    void act(async () => {
      const { skill, warnings } = await window.api.importSkill(await picked.text())
      setMessage(`Imported “${skill.workflow.name}”. It stays switched off until you look through it and switch it on.${warnings.length ? ' ' + warnings.join(' ') : ''}`)
    })
  }

  const q = query.trim().toLowerCase()
  const shown = q ? skills.filter((s) => [s.workflow.name, s.meta.whenToUse, s.meta.category, ...s.meta.domains].join(' ').toLowerCase().includes(q)) : skills

  if (!settings) return <p className="setting-note">Loading…</p>

  return (
    <div className="skills-settings">
      <div className="skills-row">
        <span>Use saved skills</span>
        <Toggle checked={settings.enabled} onChange={(v) => update({ enabled: v })} />
      </div>
      <div className="skills-row">
        <span>Offer to save successful step-by-step runs</span>
        <Toggle checked={settings.learnFromRuns} onChange={(v) => update({ learnFromRuns: v })} />
      </div>
      <div className="skills-row">
        <span>When a skill fits</span>
        <Segmented value={settings.reuse} options={REUSE} onChange={(v) => update({ reuse: v })} />
      </div>
      <p className="setting-note">“Use automatically” only runs a skill that clearly fits, and still asks before anything that changes something.</p>

      <div className="skills-tools">
        <input type="search" placeholder="Search skills" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search skills" />
        <button type="button" className="setting-action" onClick={() => file.current?.click()}>
          Import
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={importFile} />
        {skills.length > 0 && (
          <button
            type="button"
            className="setting-action"
            onClick={() => window.confirm('Delete every learned skill in this profile? Their workflows are kept.') && void act(() => window.api.removeAllSkills(), 'All skills deleted.')}
          >
            Delete all
          </button>
        )}
      </div>
      {message && (
        <p className="setting-note" role="status">
          {message}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="setting-note">{skills.length ? 'No skills match that search.' : 'No skills yet. Turn on “Offer to save successful step-by-step runs”, then save one when a run goes well.'}</p>
      ) : (
        <ul className="skills-list">
          {shown.map((skill) => (
            <li key={skill.workflow.id} className={`skill-item ${skill.health}`}>
              <div className="skill-item-head">
                {renaming?.id === skill.workflow.id ? (
                  <form
                    className="skills-tools"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const name = renaming.name.trim()
                      setRenaming(null)
                      if (name && name !== skill.workflow.name) void act(() => window.api.editSkill(skill.workflow.id, { name }))
                    }}
                  >
                    <input autoFocus value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ id: skill.workflow.id, name: e.target.value })} aria-label="Skill name" />
                    <button type="submit" className="setting-action">
                      Save
                    </button>
                    <button type="button" className="setting-action" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <strong>{skill.workflow.name}</strong>
                )}
                <span className={`skill-health ${skill.health}`}>{skill.meta.trust === 'untrusted' ? 'Imported, not checked' : HEALTH[skill.health]}</span>
              </div>
              <p>{skill.meta.whenToUse}</p>
              <p className="skill-meta">
                {skill.meta.category}
                {skill.meta.domains.length ? ` · ${skill.meta.domains.join(', ')}` : ''} · version {skill.workflow.version} · {skill.workflow.steps} steps
                {skill.workflow.permissions.length ? ` · uses ${skill.workflow.permissions.join(', ')}` : ''}
              </p>
              <p className="skill-meta">{skill.stats.runs ? `${skill.stats.succeeded} of ${skill.stats.runs} runs worked · last used ${when(skill.stats.lastUsedAt)}` : 'Not used yet'}</p>
              <div className="skill-actions">
                <Toggle checked={skill.meta.enabled} onChange={(v) => void act(() => window.api.setSkillEnabled(skill.workflow.id, v))} />
                <button type="button" onClick={() => setRenaming({ id: skill.workflow.id, name: skill.workflow.name })}>
                  Rename
                </button>
                {skill.health === 'unstable' && skill.knownGoodVersion && skill.knownGoodVersion < skill.workflow.version && (
                  <button type="button" onClick={() => void act(() => window.api.rollBackSkill(skill.workflow.id), `Went back to version ${skill.knownGoodVersion}.`)}>
                    Go back to version {skill.knownGoodVersion}
                  </button>
                )}
                <button type="button" onClick={() => exportOne(skill)}>
                  Export
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => window.confirm(`Delete the skill “${skill.workflow.name}”? Its workflow is kept.`) && void act(() => window.api.removeSkill(skill.workflow.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
