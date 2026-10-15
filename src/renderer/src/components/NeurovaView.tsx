import { useCallback, useEffect, useState } from 'react'
import { Button, EmptyState, Surface } from '../ui'
import type { Project } from '../../../shared/neurova/project'
import type { AudioInfo } from '../../../shared/neurova/audio'
import type { EngineStatus } from '../../../shared/neurova/engines'
import type { NoticeKind } from '../lib/notices'
import { NeurovaStudio } from './neurova/NeurovaStudio'
import './neurova.css'

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const db = (x: number): string => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : 'silent')

export default function NeurovaView({ onClose, onNotify }: { onClose: () => void; onNotify: (text: string, kind?: NoticeKind) => void }): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [engines, setEngines] = useState<EngineStatus[]>([])
  const [info, setInfo] = useState<Record<string, AudioInfo | string>>({})
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [lyricNotes, setLyricNotes] = useState<{ warnings: string[]; notices: { section: string; message: string }[]; sections: number } | null>(null)
  const [wave, setWave] = useState<Record<string, number[]>>({})
  const [tempo, setTempo] = useState<Record<string, string>>({})
  const [install, setInstall] = useState<{ running: boolean; step: string; log: string[]; error: string | null }>({ running: false, step: 'idle', log: [], error: null })
  const [jobs, setJobs] = useState<{ id: string; projectId: string; state: string; stage: string; error: string | null; cpuOnly: boolean }[]>([])
  const [seconds, setSeconds] = useState('30')
  const [instrumental, setInstrumental] = useState(false)
  const project = projects.find((p) => p.id === openId) ?? null

  const load = useCallback(async () => setProjects(await window.api.neurovaList()), [])
  useEffect(() => {
    void load()
    const refreshEngines = (): void => { void window.api.neurovaEngines().then(setEngines).catch(() => setEngines([])) }
    const refreshInstall = (): void => { void window.api.neurovaInstallStatus().then(setInstall).catch(() => undefined); refreshEngines() }
    const refreshJobs = (): void => { void window.api.neurovaJobs().then(setJobs).catch(() => undefined); void load(); refreshEngines() }
    refreshEngines(); refreshInstall(); refreshJobs()
    const offs = [window.api.onNeurovaChanged(() => void load()), window.api.onNeurovaInstall(refreshInstall), window.api.onNeurovaJobs(refreshJobs)]
    return () => offs.forEach((off) => off())
  }, [load])

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      if (done) onNotify(done)
    } catch (err) {
      onNotify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const create = (): Promise<void> =>
    run(async () => {
      const p = await window.api.neurovaCreate(title || 'Untitled song')
      setTitle('')
      setOpenId(p.id)
    })

  const checkLyrics = async (text: string): Promise<void> => {
    if (!text.trim()) { setLyricNotes(null); return }
    const r = await window.api.neurovaLyrics(text)
    setLyricNotes({ warnings: r.warnings, notices: r.notices, sections: r.sections.length })
  }
  const showWave = async (projectId: string, artifactId: string): Promise<void> => {
    const w = await window.api.neurovaWaveform(projectId, artifactId)
    setWave((m) => ({ ...m, [artifactId]: w }))
  }
  const showTempo = async (projectId: string, artifactId: string): Promise<void> => {
    const t = await window.api.neurovaTempo(projectId, artifactId)
    setTempo((m) => ({ ...m, [artifactId]: t ? 'About ' + t.bpm + ' BPM (could also read as ' + t.alternatives.join(' or ') + '); reliability ' + t.reliability + '.' : 'There is not enough steady rhythm to estimate a tempo.' }))
  }
  const selectedVersion = project?.versions.find((v) => v.id === project.selectedVersionId) ?? null
  const artifactOf = (artifactId: string) => project?.artifacts.find((a) => a.id === artifactId)

  return (
    <Surface title="NEUROVA" onClose={onClose} className="nv-view">
      <div className="nv-body">
        <aside className="nv-side" aria-label="Projects">
          <div className="nv-new">
            <input value={title} placeholder="Name a new song" aria-label="Name a new song" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
            <Button kind="primary" size="small" disabled={busy} onClick={() => void create()}>Create</Button>
          </div>
          <Button size="small" disabled={busy} onClick={() => void run(async () => { const p = await window.api.neurovaImportPackage(); if (p) setOpenId(p.id) }, 'Project imported.')}>Import a project folder</Button>
          <ul className="nv-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="nv-item" aria-current={p.id === openId ? 'true' : undefined} onClick={() => setOpenId(p.id)}>
                  <strong>{p.title}</strong>
                  <span>{p.versions.length} {p.versions.length === 1 ? 'version' : 'versions'}</span>
                </button>
              </li>
            ))}
          </ul>
          <section className="nv-engines" aria-label="Song generation">
            <h3>Song generation</h3>
            {engines.map((e) => (
              <p key={e.id}><strong>{e.name}</strong><br /><span>{e.reason}</span></p>
            ))}
            {engines.some((e) => e.readiness === 'no-runtime' && e.id === 'ace-step') && (
              <Button size="small" disabled={install.running} onClick={() => void window.api.neurovaInstallRuntime()}>Install the ACE-Step engine</Button>
            )}
            {engines.some((e) => e.readiness === 'no-model' && e.id === 'ace-step') && (
              <Button size="small" disabled={install.running} onClick={() => void window.api.neurovaInstallModels()}>Download the model files (several GB)</Button>
            )}
            {install.running && <Button size="small" kind="danger" onClick={() => void window.api.neurovaInstallCancel()}>Stop</Button>}
            {install.error && <p className="nv-bad" role="alert">{install.error}</p>}
            {install.log.length > 0 && <pre className="nv-log" aria-label="Installation output">{install.log.slice(-6).join('\n')}</pre>}
            <p className="nv-faint">Songs are made on this computer by ACE-Step. Without a GPU it runs on the processor, which is slow.</p>
          </section>
        </aside>

        <main className="nv-main">
          {!project ? (
            <EmptyState>Create a song project, or pick one on the left.</EmptyState>
          ) : (
            <>
              <header className="nv-head">
                <input className="nv-title" value={project.title} aria-label="Song title" onChange={(e) => void window.api.neurovaUpdate(project.id, { title: e.target.value })} />
                <Button size="small" kind="danger" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaRemove(project.id); setOpenId(null) }, 'Project deleted.')}>Delete project</Button>
              </header>
              <label className="nv-label">What this song is meant to be
                <textarea defaultValue={project.brief} key={`b-${project.id}`} rows={3} onBlur={(e) => e.target.value !== project.brief && void window.api.neurovaUpdate(project.id, { brief: e.target.value })} />
              </label>
              <label className="nv-label">Lyrics
                <textarea defaultValue={project.lyrics} key={`l-${project.id}`} rows={4} onBlur={(e) => { void checkLyrics(e.target.value); if (e.target.value !== project.lyrics) void window.api.neurovaUpdate(project.id, { lyrics: e.target.value }) }} />
              </label>
              {lyricNotes && (
                <ul className="nv-facts" aria-live="polite">
                  <li>{lyricNotes.sections} lyric section{lyricNotes.sections === 1 ? '' : 's'} found. Your text is kept exactly as written.</li>
                  {lyricNotes.warnings.map((w) => <li key={w}>{w}</li>)}
                  {lyricNotes.notices.map((n, i) => <li key={i}>{n.section}: {n.message}</li>)}
                </ul>
              )}

              <div className="nv-row">
                <h3>Make a song</h3>
                <label className="nv-faint">Length (s) <input style={{ width: 56 }} value={seconds} onChange={(e) => setSeconds(e.target.value)} inputMode="numeric" aria-label="Length in seconds" /></label>
                <label className="nv-faint"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> Instrumental</label>
                <Button size="small" kind="primary" disabled={busy || jobs.some((j) => j.projectId === project.id && !['completed', 'failed', 'cancelled', 'interrupted'].includes(j.state))}
                  onClick={() => void run(async () => { await window.api.neurovaGenerate(project.id, { prompt: project.brief, lyrics: project.lyrics || undefined, instrumental, durationSec: Number(seconds) || undefined }) })}>Generate</Button>
              </div>
              {jobs.filter((j) => j.projectId === project.id).slice(0, 3).map((j) => (
                <div key={j.id} className="nv-job" role="status">
                  <strong>{j.state === 'completed' ? 'Finished' : j.state === 'failed' ? 'Failed' : j.state === 'cancelled' ? 'Stopped' : 'Working'}</strong>
                  <span className="nv-faint"> {['completed', 'failed', 'cancelled'].includes(j.state) ? '' : j.stage}{j.cpuOnly && !['completed', 'failed', 'cancelled'].includes(j.state) ? ' (processor only, this can take a long time)' : ''}</span>
                  {j.error && <div className="nv-bad">{j.error}</div>}
                  {!['completed', 'failed', 'cancelled'].includes(j.state) && <Button size="tiny" kind="danger" onClick={() => void window.api.neurovaCancelJob(j.id)}>Cancel</Button>}
                </div>
              ))}
              <div className="nv-row">
                <h3>Versions</h3>
                <Button size="small" kind="primary" busy={busy} onClick={() => void run(async () => { await window.api.neurovaImportAudio(project.id) })}>Add a WAV file</Button>
                <Button size="small" disabled={busy} onClick={() => void run(async () => { const p = await window.api.neurovaExportPackage(project.id); if (p) onNotify(`Project folder saved to ${p}`) })}>Save project folder</Button>
              </div>
              {project.versions.length === 0 && <EmptyState>No audio yet. Add a WAV file to start a first version.</EmptyState>}
              <ol className="nv-versions">
                {[...project.versions].reverse().map((v) => {
                  const a = artifactOf(v.artifactId)
                  const res = info[v.artifactId]
                  const current = v.id === project.selectedVersionId
                  return (
                    <li key={v.id} className={current ? 'nv-version current' : 'nv-version'}>
                      <div>
                        <strong>{v.name}</strong> {current && <em>current</em>}
                        <div className="nv-faint">
                          {v.kind === 'restore' ? 'Restored copy' : v.kind === 'revision' ? 'Added after another version' : 'First version'}
                          {a ? ` · ${mmss(a.durationSec)} · ${a.sampleRate} Hz · ${a.channels === 1 ? 'mono' : `${a.channels} channels`} · ${a.bitDepth}-bit` : ''}
                        </div>
                        {v.note && <div className="nv-note">{v.note}</div>}
                        {typeof res === 'string' && <div className="nv-bad">{res}</div>}
                        {tempo[v.artifactId] && <div className="nv-note">{tempo[v.artifactId]}</div>}
                        {wave[v.artifactId] && wave[v.artifactId].length > 0 && (
                          <svg className="nv-wave" viewBox={'0 0 ' + wave[v.artifactId].length + ' 40'} preserveAspectRatio="none" role="img" aria-label="Loudness over the length of this audio">
                            {wave[v.artifactId].map((p, i) => <line key={i} x1={i + 0.5} x2={i + 0.5} y1={20 - p * 20} y2={20 + p * 20} stroke="currentColor" strokeWidth="0.8" />)}
                          </svg>
                        )}
                        {res && typeof res !== 'string' && (
                          <ul className="nv-facts">
                            <li>Peak {db(res.peak)}</li>
                            <li>Average level {db(res.rms)}</li>
                            <li>{res.clippedSamples === 0 ? 'No clipped samples' : `${res.clippedSamples} clipped samples`}</li>
                            <li>{res.lowEnergy.length === 0 ? 'No long quiet stretches' : `Quiet for a second or more at ${res.lowEnergy.map((x) => `${mmss(x.startSec)}–${mmss(x.endSec)}`).join(', ')}`}</li>
                            {res.warnings.map((w) => <li key={w} className="nv-bad">{w}</li>)}
                          </ul>
                        )}
                      </div>
                      <div className="nv-actions">
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { let r: AudioInfo | string; try { r = await window.api.neurovaAnalyse(project.id, v.artifactId) } catch (e) { r = e instanceof Error ? e.message : 'Could not check this file.' } setInfo((m) => ({ ...m, [v.artifactId]: r })) })}>Check audio</Button>
                        {!current && <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaSelectVersion(project.id, v.id) })}>Make current</Button>}
                        {!current && <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaRestoreVersion(project.id, v.id) }, 'Restored as a new version.')}>Restore as new</Button>}
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await showWave(project.id, v.artifactId) })}>Waveform</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await showTempo(project.id, v.artifactId) })}>Tempo</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaProcess(project.id, v.id, { kind: 'fade-in', seconds: 1 }) }, 'Saved as a new version.')}>Fade in 1s</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaProcess(project.id, v.id, { kind: 'fade-out', seconds: 2 }) }, 'Saved as a new version.')}>Fade out 2s</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaProcess(project.id, v.id, { kind: 'trim-silence' }) }, 'Saved as a new version.')}>Trim silence</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaProcess(project.id, v.id, { kind: 'gain', db: -3 }) }, 'Saved as a new version.')}>Quieter 3 dB</Button>
                        <Button size="tiny" disabled={busy} onClick={() => void run(async () => { const p = await window.api.neurovaExportVersion(project.id, v.id); if (p) onNotify(`Exported to ${p}`) })}>Export</Button>
                        <Button size="tiny" kind="danger" disabled={busy} onClick={() => void run(async () => { await window.api.neurovaRemoveVersion(project.id, v.id) })}>Remove</Button>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <NeurovaStudio project={project} onNotify={onNotify} />
              {selectedVersion && <p className="nv-faint">Removing a version never deletes your original file; only this project's own copy goes, and only if no other version uses it.</p>}
            </>
          )}
        </main>
      </div>
    </Surface>
  )
}
