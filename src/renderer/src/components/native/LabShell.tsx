import type { ReactNode } from 'react'
import type { LiveInstance } from './surfaces'
import Parameters from './Parameters'
import './phase2.css'
import './phase3.css'
import './phase4.css'
import './phase5.css'

/**
 * The frame every Phase 5 laboratory wears.
 *
 * ## Why a shared shell and not seven copies
 *
 * Seven laboratories with the same title bar, the same refusal line, the same assumptions panel and the same settings
 * drawer is seven places for one of them to drift. The shell owns all four; what each laboratory writes is only the
 * part that is about its own subject.
 *
 * This is deliberately *not* a universal laboratory. The brief is explicit that an electronics laboratory should feel
 * like an electronics laboratory, so the shell supplies the furniture and never the content — every one of the seven
 * draws its own middle, and they look nothing like each other.
 *
 * ## Refusals and failures are different things
 *
 * An engine refusing — a prefix that is not a prefix, a dataset too small to split — is a sentence about what you
 * asked for, and the laboratory stays usable. A worker breaking is a fault in Orbis. They are shown differently
 * because they mean different things and want different responses.
 */

export interface LabShellProps {
  /** What the laboratory is, for the heading. */
  title: string
  /** A short line about what is currently shown, beside the title. */
  summary?: string
  /** The engine's own refusal, where there is one. */
  refused?: { says: string; fix: string } | null
  /** A fault in Orbis rather than in what was asked. */
  broke?: string | null
  busy?: boolean
  /** Shown while nothing has come back yet. */
  waitingFor?: string
  /** True once there is something to show. */
  ready: boolean
  /** The main area. */
  children: ReactNode
  /** The column down the right: panels of figures and notes. */
  aside?: ReactNode
  /** What the engine does not model. Comes from the engine, never written here. */
  assumptions?: readonly string[]
  /** Tabs across the top, where the laboratory has more than one view. */
  tabs?: readonly { id: string; label: string }[]
  showing?: string
  onShow?(id: string): void
  instance?: LiveInstance
  onConfigure?(values: Record<string, unknown>): Promise<Readonly<Record<string, string>> | null>
}

export default function LabShell({
  title,
  summary,
  refused,
  broke,
  busy,
  waitingFor,
  ready,
  children,
  aside,
  assumptions,
  tabs,
  showing,
  onShow,
  instance,
  onConfigure
}: LabShellProps): React.JSX.Element {
  // Both halves of the side column can be empty at once, and then there is nothing to reserve room for.
  const hasAside = aside !== undefined && aside !== null && aside !== false
  const hasAssumptions = assumptions !== undefined && assumptions.length > 0

  return (
    <section className="p2 p4 p5" aria-label={title}>
      <header className="p2-bar">
        <strong>{title}</strong>
        {summary !== undefined && summary.length > 0 && <span className="p2-faint">{summary}</span>}
      </header>

      {refused != null && (
        <p className="p2-refused" role="status">
          <strong>{refused.says}</strong> {refused.fix}
        </p>
      )}
      {broke != null && broke.length > 0 && (
        <p className="p2-refused" role="status">
          {broke}
        </p>
      )}

      {tabs !== undefined && tabs.length > 1 && (
        <div className="p2-tabs" role="tablist">
          {tabs.map((one) => (
            <button
              key={one.id}
              type="button"
              role="tab"
              className="p2-tab"
              aria-selected={showing === one.id}
              onClick={() => onShow?.(one.id)}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      {/* With nothing to put beside it, the side column was still holding its 260px and the main column was laid
          out into what was left — so a lab with no aside got a narrow panel and a wide empty margin. */}
      <div className={`p3-split${hasAside || hasAssumptions ? '' : ' p3-wide'}`}>
        <div className="p5-main">
          {ready ? children : <p className="p2-faint">{busy === true ? (waitingFor ?? 'Working it out…') : 'Nothing worked out yet.'}</p>}
        </div>

        {(hasAside || hasAssumptions) && (
        <div className="p3-side">
          {aside}
          {assumptions !== undefined && assumptions.length > 0 && (
            <div className="p3-panel">
              <h4>What this does not model</h4>
              <ul className="p3-assumptions">
                {assumptions.map((one, index) => (
                  <li key={index}>{one}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        )}
      </div>

      {instance !== undefined && onConfigure !== undefined && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={busy === true}
          />
        </details>
      )}
    </section>
  )
}

/** A panel of name-and-value pairs, which every one of these laboratories wants. */
export function Facts({ title, rows, about }: { title: string; rows: readonly (readonly [string, string | number])[]; about?: string }): React.JSX.Element | null {
  const kept = rows.filter(([, value]) => value !== '' && value !== undefined && value !== null)
  if (kept.length === 0) return null
  return (
    <div className="p3-panel">
      <h4>{title}</h4>
      <dl className="p3-facts">
        {kept.map(([name, value]) => (
          <div key={name} className="p4-fact">
            <dt>{name}</dt>
            <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
          </div>
        ))}
      </dl>
      {about !== undefined && <p className="p2-faint">{about}</p>}
    </div>
  )
}

/** The engine's own notes. Never written by a surface, so a laboratory cannot claim something the engine did not. */
export function Notes({ title, notes }: { title: string; notes: readonly string[] | undefined }): React.JSX.Element | null {
  if (notes === undefined || notes.length === 0) return null
  return (
    <div className="p3-panel">
      <h4>{title}</h4>
      <ul className="p4-notes">
        {notes.map((one, index) => (
          <li key={index}>{one}</li>
        ))}
      </ul>
    </div>
  )
}

/** A refusal that came back inside a result rather than instead of one, so one panel can fail without the rest. */
export function Refused({ held }: { held: unknown }): React.JSX.Element | null {
  const refused = (held as { refused?: { says: string; fix: string } } | null)?.refused
  if (refused === undefined) return null
  return (
    <p className="p2-refused" role="status">
      <strong>{refused.says}</strong> {refused.fix}
    </p>
  )
}

/** True when a result is really a refusal wearing a result's clothes. */
export const didRefuse = (held: unknown): boolean =>
  typeof held === 'object' && held !== null && 'refused' in (held as Record<string, unknown>)
