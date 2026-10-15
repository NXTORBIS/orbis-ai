import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '../../../../shared/neurova/project'
import type { Edit, Finding, Plan } from '../../../../shared/neurova/plan'
import { parseLyrics, diagnose } from '../../../../shared/neurova/lyrics'
import type { NeurovaWorkspace } from '../../../../shared/types'
import { safeFileName } from '../../../../shared/neurova/project'
import { ExportDialog } from './index'
import type { ExportProgress } from './index'
import { PlanEditor, LyricsPanel, CandidateBoard, DiagnosticsPanel, VersionTimeline } from './index'
import type { CandidateCard, DiagnosticItem, EvidenceItem } from './index'

type RankResult = Awaited<ReturnType<typeof window.api.neurovaRank>>

/** Plan, lyrics, candidates, diagnostics and timeline for one project. Every value shown comes from the main process. */
export function NeurovaStudio({ project, onNotify }: { project: Project; onNotify: (text: string) => void }): React.JSX.Element {
  const id = project.id
  const [ws, setWs] = useState<NeurovaWorkspace | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [refusal, setRefusal] = useState<string | null>(null)
  const [rank, setRank] = useState<RankResult | null>(null)
  const [deep, setDeep] = useState<Record<string, unknown> | null>(null)
  const [tab, setTab] = useState<'plan' | 'lyrics' | 'candidates' | 'checks' | 'timeline' | 'export'>('plan')
  const [exp, setExp] = useState<ExportProgress>({ state: 'idle' })
  const [src, setSrc] = useState<{ format: string; durationSec: number; sampleRate: number; channels: number; bitDepth: number; bytes: number } | null>(null)

  const refresh = useCallback(async () => {
    const w = await window.api.neurovaWorkspace(id)
    setWs(w)
    setFindings((await window.api.neurovaPlanFindings(id)) as Finding[])
    setRank(await window.api.neurovaRank(id).catch(() => null))
  }, [id])
  useEffect(() => { void refresh().catch(() => undefined) }, [refresh, project.versions.length, project.lyrics])

  const doc = useMemo(() => parseLyrics(project.lyrics ?? ''), [project.lyrics])
  const notices = useMemo(() => diagnose(doc), [doc])
  const plan = ws?.plan as Plan | null | undefined

  const cards: CandidateCard[] = project.versions.map((v) => {
    const f = ws?.feedback[v.id]
    return {
      id: v.id, name: v.name, state: v.id === project.selectedVersionId ? 'current' : 'saved',
      durationSec: null, engine: String((v as { source?: string }).source ?? 'imported'), changeSummary: v.note,
      preference: f?.preference ?? null, rejected: f?.rejected ?? false, finalist: f?.finalist ?? false, note: f?.note ?? ''
    }
  })
  const feedback = (vid: string, patch: Parameters<typeof window.api.neurovaFeedback>[2]): void => {
    void window.api.neurovaFeedback(id, vid, patch).then(setWs).then(() => refresh())
  }

  const diagnostics: DiagnosticItem[] = [
    ...findings.map((f, i): DiagnosticItem => ({ id: `plan-${i}`, severity: f.level === 'error' ? 'error' : 'info', summary: f.message, evidence: 'From the plan.', suggestion: '', dismissed: ws?.dismissed.includes(`plan-${i}`) ?? false })),
    ...notices.map((n, i): DiagnosticItem => ({ id: `lyr-${i}`, severity: 'warning', summary: n.message, evidence: `Section ${n.section}${n.line ? `, line ${n.line}` : ''}.`, suggestion: '', dismissed: ws?.dismissed.includes(`lyr-${i}`) ?? false }))
  ]
  const evidence: EvidenceItem[] = deep
    ? Object.entries(deep).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => ({ id: k, label: k, value: String(v), kind: 'measured' as const }))
    : []

  return (
    <section className="nv-studio" aria-label="Song studio">
      <div role="tablist" className="nv-x-tabs">
        {(['plan', 'lyrics', 'candidates', 'checks', 'timeline', 'export'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="queue-btn ghost" onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div className="nv-tab-body" key={tab}>
      {tab === 'plan' && (plan
        ? <PlanEditor plan={plan} findings={findings} lastRefusal={refusal}
            onEdit={(e: Edit) => void window.api.neurovaPlanEdit(id, e).then((r) => { setWs(r.workspace); setRefusal(r.reason); void refresh() })}
            onUndo={() => void window.api.neurovaPlanUndo(id).then((w) => { setWs(w); void refresh() })} />
        : <button className="queue-btn" onClick={() => void window.api.neurovaPlanPropose(id).then((w) => { setWs(w); void refresh() })}>Suggest a plan from the brief and lyrics</button>)}
      {tab === 'lyrics' && <LyricsPanel doc={doc} notices={notices} changed={ws?.originalLyrics != null && ws.originalLyrics !== project.lyrics}
        onRestoreOriginal={() => { if (ws?.originalLyrics != null) void window.api.neurovaUpdate(id, { lyrics: ws.originalLyrics }) }} />}
      {tab === 'candidates' && <CandidateBoard candidates={cards} evidence={(rank?.evidence ?? []) as never} criteria={rank?.criteria ?? []} ranking={(rank?.ranking ?? []) as never}
        selectedId={project.selectedVersionId}
        onPreference={(vid, p) => feedback(vid, { preference: p })} onReject={(vid, r) => feedback(vid, { rejected: r })}
        onFinalist={(vid, f) => feedback(vid, { finalist: f })} onNote={(vid, n) => feedback(vid, { note: n })}
        onSelect={(vid) => void window.api.neurovaSelectVersion(id, vid)} />}
      {tab === 'checks' && (
        <>
          <button className="queue-btn" disabled={!project.selectedVersionId} onClick={() => {
            const v = project.versions.find((x) => x.id === project.selectedVersionId)
            if (v) void window.api.neurovaDeepAnalysis(id, v.artifactId).then(setDeep).catch((e) => onNotify(e instanceof Error ? e.message : 'Analysis failed.'))
          }}>Run deeper analysis on the current version</button>
          <DiagnosticsPanel diagnostics={diagnostics} evidence={evidence}
            onDismiss={(d) => void window.api.neurovaDismiss(id, d, true).then(setWs)} onUndismiss={(d) => void window.api.neurovaDismiss(id, d, false).then(setWs)} />
        </>
      )}
      {tab === 'export' && (() => {
        const v = project.versions.find((x) => x.id === project.selectedVersionId)
        if (!v) return <p className="nv-faint">Choose a version first.</p>
        if (!src) { void window.api.neurovaAnalyse(id, v.artifactId).then((i) => setSrc({ format: 'wav', durationSec: i.durationSec, sampleRate: i.sampleRate, channels: i.channels, bitDepth: i.bitDepth, bytes: Math.round(i.frames * i.channels * (i.bitDepth / 8)) })).catch(() => undefined); return <p className="nv-faint">Reading the file…</p> }
        return <ExportDialog formats={['wav', 'flac']} source={src} output={src} defaultName={safeFileName(`${project.title} - ${v.name}`, 'wav')} safeName={(n, f) => safeFileName(n.replace(/\.[^.]*$/, ''), f)} progress={exp}
          onExport={(opt) => { setExp({ state: 'working', message: 'Choose where to save it.' }); void window.api.neurovaExportVersion(id, v.id, opt.format === 'flac' ? 'flac' : 'wav').then((path) => setExp(path ? { state: 'done', path } : { state: 'idle' })).catch((e) => setExp({ state: 'failed', message: e instanceof Error ? e.message : 'Export failed.' })) }}
          onClose={() => setTab('timeline')} />
      })()}
      {tab === 'timeline' && <VersionTimeline project={project} exportedIds={ws?.exports.map((e) => e.versionId) ?? []}
        onSelect={(vid) => void window.api.neurovaSelectVersion(id, vid)} onRestore={(vid) => void window.api.neurovaRestoreVersion(id, vid)}
        onCompare={() => setTab('candidates')} />}
      </div>
    </section>
  )
}
