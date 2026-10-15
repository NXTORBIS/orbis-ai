import { useCallback, useEffect, useState } from 'react'
import { Button, EmptyState, Surface } from '../ui'
import type { Project } from '../../../shared/neurova/project'
import type { AudioInfo } from '../../../shared/neurova/audio'
import type { EngineStatus } from '../../../shared/neurova/engines'
import type { NoticeKind } from '../lib/notices'
import { NeurovaStudio } from './neurova/NeurovaStudio'
import { Composer, GenerationProgress, WavePlayer } from './neurova'
import type { Composed } from './neurova'
import { isTerminal } from '../../../shared/neurova/composer'
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
  const [composed, setComposed] = useState<Composed | null>(null)
  const [engineId, setEngineId] = useState<'ace-step' | 'heartmula'>('ace-step')
  const [tags, setTags] = useState('')
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
            {engines.filter((e) => e.readiness === 'no-runtime').map((e) => (
              <Button key={`r-${e.id}`} size="small" disabled={install.running} onClick={() => void window.api.neurovaInstallRuntime(e.id as 'ace-step' | 'heartmula')}>Install {e.name}</Button>
            ))}
            {engines.filter((e) => e.readiness === 'no-model').map((e) => (
              <Button key={`m-${e.id}`} size="small" disabled={install.running} onClick={() => void window.api.neurovaInstallModels(e.id as 'ace-step' | 'heartmula')}>Download {e.name} model files (several GB)</Button>
            ))}
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
              <Composer projectKey={project.id} brief={project.brief} lyrics={project.lyrics ?? ''} onChange={setComposed}
                onCommit={(patch) => void window.api.neurovaUpdate(project.id, patch)} onLyricsBlur={(t) => void checkLyrics(t)} />
              {lyricNotes && (
                <ul className="nv-facts" aria-live="polite">
                  <li>{lyricNotes.sections} lyric section{lyricNotes.sections === 1 ? '' : 's'} found. Your text is kept exactly as written.</li>
                  {lyricNotes.warnings.map((w) => <li key={w}>{w}</li>)}
                  {lyricNotes.notices.map((n, i) => <li key={i}>{n.section}: {n.message}</li>)}
                </ul>
              )}

              <div className="nv-row">
                <h3>Make a song</h3>
                <label className="nv-faint">Engine <select value={engineId} onChange={(e) => setEngineId(e.target.value as 'ace-step' | 'heartmula')} aria-label="Engine">
                  <option value="ace-step">ACE-Step 1.5</option><option value="heartmula">HeartMuLa</option></select></label>
                {engineId === 'heartmula' && <label className="nv-faint">Tags <input style={{ width: 180 }} value={tags} placeholder="piano,calm,romantic" onChange={(e) => setTags(e.target.value)} aria-label="Style tags, comma separated" /></label>}
                <Button size="small" kind="primary" disabled={busy || jobs.some((j) => j.projectId === project.id && !isTerminal(j.state))}
                  onClick={() => void run(async () => { await window.api.neurovaGenerate(project.id, { prompt: composed?.caption ?? project.brief, lyrics: (composed?.instrumental ? undefined : composed?.lyrics || project.lyrics) || undefined, instrumental: composed?.instrumental ?? false, durationSec: composed?.durationSec, engine: engineId, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }) })}>Generate</Button>
              </div>
              {jobs.filter((j) => j.projectId === project.id).slice(0, 3).map((j) => (
                <GenerationProgress key={j.id} job={j} onCancel={(id) => void window.api.neurovaCancelJob(id)} />
              ))}
              <div className="nv-row">
                <h3>Versions</h3>
                <Button size="small" kind="primary" busy={busy} onClick={() => void run(async () => { await window.api.neurovaImportAudio(project.id) })}>Add a WAV file</Button>
                <Button size="small" disabled={busy} onClick={() => void run(async () => { const p = await window.api.neurovaExportPackage(project.id); if (p) onNotify(`Project folder saved to ${p}`) })}>Save project folder</Button>
              </div>
              {project.versions.length === 0 && <EmptyState>No audio yet. Add a WAV file to start a first version.</EmptyState>}
              <ol className="nv-versions nv-stagger">
                {[...project.versions].reverse().map((v, vi) => {
                  const a = artifactOf(v.artifactId)
                  const res = info[v.artifactId]
                  const current = v.id === project.selectedVersionId
                  return (
                    <li key={v.id} style={{ '--i': Math.min(vi, 8) } as React.CSSProperties} className={current ? 'nv-version current' : 'nv-version'}>
                      <div>
                        <strong>{v.name}</strong> {current && <em>current</em>}
                        <div className="nv-faint">
                          {v.kind === 'restore' ? 'Restored copy' : v.kind === 'revision' ? 'Added after another version' : 'First version'}
                          {a ? ` · ${mmss(a.durationSec)} · ${a.sampleRate} Hz · ${a.channels === 1 ? 'mono' : `${a.channels} channels`} · ${a.bitDepth}-bit` : ''}
                        </div>
                        {v.note && <div className="nv-note">{v.note}</div>}
                        {typeof res === 'string' && <div className="nv-bad">{res}</div>}
                        {a && <WavePlayer projectId={project.id} artifactId={v.artifactId} label={v.name} />}
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
