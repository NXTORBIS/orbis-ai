import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldAlert, Wrench } from 'lucide-react'
import type { Workflow } from '../../../shared/workflows'
import type { Finding, HealthReport, Repair } from '../../../shared/workflowHealth'
import type { Migration, Missing } from '../../../shared/workflowCompat'
import type { NoticeKind } from '../App'

/**
 * What a workflow's own runs say about it.
 *
 * Every figure here was measured from runs that really happened, and the panel says so when there are not enough of
 * them: a workflow that has run twice shows "two runs", not a success rate dressed up as a measurement. Nothing is
 * estimated to fill a space.
 *
 * The one action on this screen -- applying a migration -- changes real steps in a real workflow, so it is shown as a
 * proposal with the exact before and after, and nothing happens until somebody presses it. A workflow that repaired
 * itself would be one nobody could predict from reading it.
 */

const VERDICT: Record<HealthReport['health'], { label: string; tone: string }> = {
  unproven: { label: 'Not proven yet', tone: 'muted' },
  healthy: { label: 'Working', tone: 'ok' },
  flaky: { label: 'Unreliable', tone: 'warn' },
  failing: { label: 'Failing', tone: 'warn' },
  broken: { label: 'Broken', tone: 'bad' },
  stale: { label: 'Not used lately', tone: 'muted' }
}

/** The badge a workflow card wears. Small enough for a list, honest enough to act on. */
export function HealthBadge({ report }: { report: HealthReport | undefined }): React.JSX.Element | null {
  if (!report) return null
  const verdict = VERDICT[report.health]
  return (
    <span className={`wf-health ${verdict.tone}`} title={report.summary}>
      {verdict.label}
    </span>
  )
}

interface Props {
  workflow: Workflow
  onNotify(message: string, kind?: NoticeKind): void
  /** Called after a migration is applied, so the library and the editor show the new steps. */
  onChanged(): void
}

export default function WorkflowInsights({ workflow, onNotify, onChanged }: Props): React.JSX.Element {
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [compat, setCompat] = useState<{ ok: boolean; why: string; problems: Missing[]; migration: Migration } | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      // Read together: four separate spinners for one screen is four chances to look broken.
      const [h, f, r, c] = await Promise.all([
        window.api.workflowHealth(workflow.id),
        window.api.workflowFindings(workflow.id),
        window.api.workflowRepairs(workflow.id),
        window.api.workflowCompatibility(workflow.id)
      ])
      setHealth(h)
      setFindings(f)
      setRepairs(r)
      setCompat(c)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // Re-read when the workflow itself changes, so the panel never describes a version that is no longer open.
  }, [workflow.id, workflow.version])

  const applyMigration = async (): Promise<void> => {
    setApplying(true)
    try {
      await window.api.applyWorkflowMigration(workflow.id)
      onNotify('The steps were updated for this version of Orbis. The old version is in the history.')
      onChanged()
      await load()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setApplying(false)
    }
  }

  const verdict = health ? VERDICT[health.health] : null

  return (
    <section className="wf-insights" aria-label="What the runs show">
      <header className="wf-insights-head">
        <h3>What the runs show</h3>
        <button type="button" className="b-icon" onClick={() => void load()} disabled={busy} aria-label="Read again">
          <RefreshCw size={13} className={busy ? 'spin' : undefined} />
        </button>
      </header>

      {/* ---- how it is doing */}
      {health && verdict && (
        <div className={`wf-verdict ${verdict.tone}`}>
          <span className="wf-verdict-label">{verdict.label}</span>
          <p>{health.summary}</p>
          <p className="wf-muted">
            {health.runs} run{health.runs === 1 ? '' : 's'}
            {/* Withheld rather than invented when there are too few runs for it to mean anything. */}
            {health.successRate !== null ? ` · ${Math.round(health.successRate * 100)}% succeeded` : ' · too few to give a rate'}
            {health.lastRunAt ? ` · last ${new Date(health.lastRunAt).toLocaleString()}` : ''}
          </p>
          {health.worstStep && (
            <p className="wf-muted">
              Fails most at “{health.worstStep.label}” — {health.worstStep.failures} of {health.worstStep.of} times it ran.
            </p>
          )}
        </div>
      )}

      {/* ---- whether it still fits this Orbis */}
      {compat && !compat.ok && (
        <div className="wf-issue bad">
          <ShieldAlert size={14} />
          <div>
            <b>This will not run as written</b>
            <p>{compat.why}</p>
            {compat.problems.map((p) => (
              <p key={`${p.kind}:${p.id}`} className="wf-muted">
                {p.steps.join(', ')} — {p.detail}
              </p>
            ))}
            {compat.migration.changes.length > 0 && (
              <>
                <p className="wf-muted">Orbis can change {compat.migration.changes.length === 1 ? 'one step' : `${compat.migration.changes.length} steps`}:</p>
                <ul className="wf-changes">
                  {compat.migration.changes.map((c, i) => (
                    <li key={i}>
                      <b>{c.step}</b>: <code>{c.was}</code> → <code>{c.now}</code>
                    </li>
                  ))}
                </ul>
                <button type="button" className="primary-btn" onClick={() => void applyMigration()} disabled={applying}>
                  {applying ? 'Updating…' : 'Update these steps'}
                </button>
              </>
            )}
            {compat.migration.unrepairable.length > 0 && (
              <p className="wf-muted">
                {compat.migration.unrepairable.length === 1 ? 'One step needs' : `${compat.migration.unrepairable.length} steps need`} changing by hand — Orbis cannot tell what
                {compat.migration.unrepairable.length === 1 ? ' it' : ' they'} should point at now.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- what to do about one that keeps failing */}
      {repairs.length > 0 && (
        <div className="wf-issue warn">
          <Wrench size={14} />
          <div>
            <b>It keeps failing at the same place</b>
            {repairs.map((r, i) => (
              <div key={i} className="wf-repair">
                <b>{r.step}</b>
                <p className="wf-muted">{r.because}</p>
                <p>{r.proposal}</p>
              </div>
            ))}
            {/* Nothing here is applied automatically, and the panel says so rather than leaving it implied. */}
            <p className="wf-muted">Orbis does not change a workflow on its own. These are for you to decide on.</p>
          </div>
        </div>
      )}

      {/* ---- what the timings show */}
      {findings.length > 0 && (
        <div className="wf-issue">
          <Clock size={14} />
          <div>
            <b>Worth a look</b>
            {findings.map((f, i) => (
              <div key={i} className="wf-finding">
                <b>{f.step}</b>
                <p className="wf-muted">{f.detail}</p>
                <p>{f.suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- nothing to say, said plainly */}
      {!busy && health && health.runs > 0 && compat?.ok && !repairs.length && !findings.length && (
        <p className="wf-none">
          <CheckCircle2 size={13} /> Nothing to flag. Every step this workflow uses exists, and its runs show no problem.
        </p>
      )}
      {!busy && health && health.runs === 0 && (
        <p className="wf-none">
          <AlertTriangle size={13} /> It has not run yet, so there is nothing to measure. Run it once and this fills in.
        </p>
      )}
    </section>
  )
}
