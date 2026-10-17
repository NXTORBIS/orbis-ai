import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, ListChecks, MessageSquareText, Play, Sparkles, Target, TrendingUp } from 'lucide-react'
import Challenge, { type ChallengeShape } from './Challenge'
import Quiz from './Quiz'
import Socratic from './Socratic'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * What you actually know.
 *
 * ## The one thing this page refuses to do
 *
 * It will not show a bar that climbs because pages were opened. Every figure here comes from measured evidence --
 * something recalled, something used on a new problem, something explained -- and a concept that was read and not
 * retained shows as barely known, which is what it is. A flattering progress bar is the most demoralising thing a
 * study tool can have, because the student finds out it was wrong in an exam.
 *
 * ## Why it names the missing dimension
 *
 * "Not holding yet" is useless. "You can follow it, but not produce it from memory" tells somebody what kind of
 * work to do next, which is the entire point of measuring the dimensions separately.
 *
 * ## Strengths are here too
 *
 * A page of only weaknesses is an untrue picture of real progress, and an unpleasant one. What is going well is
 * shown next to what is not.
 */

interface Weak {
  conceptId: string
  name: string
  subject: string | null
  need: number
  why: string
  state: string
}

interface Strong {
  conceptId: string
  name: string
  score: number
}

interface Confused {
  conceptId: string
  name: string
  swing: number
}

interface TreeConcept {
  concept: { id: string; name: string }
  score: number
  state: string
  confidence: number
}

interface TreeChapter {
  chapter: { id: string; name: string }
  progress: { score: number; concepts: number; started: number; mastered: number; weak: number; untouched: number; confidence: number }
  concepts: readonly TreeConcept[]
}

interface TreeSubject {
  subject: string
  progress: { score: number; concepts: number; started: number; mastered: number; weak: number; untouched: number; confidence: number }
  chapters: readonly TreeChapter[]
}

const STATE_WORDS: Record<string, string> = {
  new: 'Not started',
  learning: 'Early days',
  reviewing: 'Coming along',
  stable: 'Holding',
  strong: 'Strong',
  mastered: 'Mastered',
  slipping: 'Slipping'
}

export default function Mastery({
  call,
  onStart,
  onNotify,
  onOpenOrion
}: {
  call: Call
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onNotify(message: string, kind?: NoticeKind): void
  onOpenOrion?(prompt: string): void
}): React.JSX.Element {
  const [weak, setWeak] = useState<Weak[]>([])
  const [strong, setStrong] = useState<Strong[]>([])
  const [confused, setConfused] = useState<Confused[]>([])
  const [tree, setTree] = useState<TreeSubject[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [test, setTest] = useState<ChallengeShape | null>(null)
  /**
   * Written help, offered only when it exists.
   *
   * Asked once: a button that fails because there is no key is worse than no button, so the screen finds out first
   * and shows the manual route instead.
   */
  const [canGenerate, setCanGenerate] = useState(false)
  const [quizzing, setQuizzing] = useState<{ conceptId: string; name: string } | null>(null)
  const [working, setWorking] = useState<{ conceptId: string; name: string } | null>(null)
  const [explained, setExplained] = useState<{ name: string; text: string } | null>(null)
  const [proof, setProof] = useState<{ conceptId: string; steps: readonly { label: string; done: boolean }[]; passed: boolean; missing: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const out = await call<{ weak: Weak[]; strong: Strong[]; confused: Confused[]; tree: TreeSubject[] }>('learning')
    setWeak(out?.weak ?? [])
    setStrong(out?.strong ?? [])
    setConfused(out?.confused ?? [])
    setTree(out?.tree ?? [])
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void call<{ ok: boolean }>('can-generate').then((out) => setCanGenerate(out?.ok === true))
  }, [call])

  /** Before starting, Orbis says if something underneath comes first. */
  const begin = async (conceptId: string, name: string, subject: string | null, minutes: number): Promise<void> => {
    const ready = await call<{ ready: boolean; instead: { id: string; name: string } | null; why: string }>('ready-to', conceptId)
    if (ready && !ready.ready && ready.instead) {
      onNotify(`${ready.why} Starting with ${ready.instead.name} instead.`, 'warn')
      onStart({ subject, conceptId: ready.instead.id, minutes, title: ready.instead.name })
      return
    }
    onStart({ subject, conceptId, minutes, title: name })
  }

  const nothing = tree.length === 0

  return (
    <div className="st-mastery">
      <header className="st-section-head">
        <div>
          <h2>What you know</h2>
          <p className="st-faint">Measured from what you have recalled, used and explained — never from time spent.</p>
        </div>
      </header>

      {nothing ? (
        <p className="view-empty">
          Nothing to show yet. Add your syllabus on the Plan page, then finish a session or two and this fills in.
        </p>
      ) : null}

      {weak.length > 0 ? (
        <section aria-label="What needs work">
          <h3>
            <Target size={14} aria-hidden /> What needs work
          </h3>
          <ul className="st-weak">
            {weak.map((one) => (
              <li key={one.conceptId}>
                <div>
                  <strong>{one.name}</strong>
                  <span className="st-faint small">
                    {one.subject ? `${one.subject} · ` : ''}
                    {STATE_WORDS[one.state] ?? one.state}
                  </span>
                  {/* The dimension that is holding it back, so the fix is the right kind of work. */}
                  <p className="st-faint">{one.why}</p>
                </div>
                <div className="st-row-right">
                  <button type="button" className="st-btn primary" onClick={() => void begin(one.conceptId, one.name, one.subject, 15)}>
                    <Play size={14} aria-hidden /> Fifteen minutes
                  </button>
                  {canGenerate ? (
                    <>
                      {/* Aimed at the dimension that is actually missing, not a general summary. */}
                      <button
                        type="button"
                        className="st-btn"
                        onClick={() =>
                          void call<{ ok: boolean; text?: string; why?: string }>('explain-topic', one.conceptId).then((out) => {
                            if (out?.ok && out.text) setExplained({ name: one.name, text: out.text })
                            else onNotify(out?.why ?? 'Nothing came back.', 'warn')
                          })
                        }
                      >
                        <MessageSquareText size={14} aria-hidden /> Explain this
                      </button>
                      <button type="button" className="st-btn" onClick={() => setQuizzing({ conceptId: one.conceptId, name: one.name })}>
                        <Sparkles size={14} aria-hidden /> Quiz me
                      </button>
                      {/* Asks instead of telling. "Just tell me" is on every turn of it. */}
                      <button type="button" className="st-btn" onClick={() => setWorking({ conceptId: one.conceptId, name: one.name })}>
                        <MessageSquareText size={14} aria-hidden /> Work it out with me
                      </button>
                    </>
                  ) : onOpenOrion ? (
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() => {
                        void call('orion-turn')
                        onOpenOrion(`Explain ${one.name} simply. ${one.why} Then give me one example and one question to try.`)
                      }}
                    >
                      <Sparkles size={14} aria-hidden /> Ask Orion
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {confused.length > 0 ? (
        <section aria-label="Inconsistent">
          <h3>Right sometimes, wrong sometimes</h3>
          <p className="st-faint small">These are not unknown — they are unsteady, which needs finding the shaky part rather than repeating the whole thing.</p>
          <ul className="st-weak">
            {confused.map((one) => (
              <li key={one.conceptId}>
                <div>
                  <strong>{one.name}</strong>
                </div>
                <div className="st-row-right">
                  {onOpenOrion ? (
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() => {
                        void call('orion-turn')
                        onOpenOrion(`I get ${one.name} right about half the time. Ask me questions to find which part I am getting wrong, one at a time.`)
                      }}
                    >
                      <Sparkles size={14} aria-hidden /> Find the shaky part
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {strong.length > 0 ? (
        <section aria-label="Going well">
          <h3>
            <TrendingUp size={14} aria-hidden /> Going well
          </h3>
          <ul className="st-strong">
            {strong.map((one) => (
              <li key={one.conceptId}>
                <span>{one.name}</span>
                <span className="st-faint small">{Math.round(one.score * 100)}%</span>
                <button
                  type="button"
                  className="st-link"
                  onClick={() =>
                    void call<{ steps: { label: string; done: boolean }[]; passed: boolean; missing: string }>('prove-mastery', one.conceptId).then((out) =>
                      setProof(out ? { conceptId: one.conceptId, ...out } : null)
                    )
                  }
                >
                  Prove it
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tree.length > 0 ? (
        <section aria-label="Everything">
          <h3>Everything</h3>
          <ul className="st-tree">
            {tree.map((subject) => (
              <li key={subject.subject}>
                <button type="button" className="st-tree-row" onClick={() => setOpen(open === subject.subject ? null : subject.subject)} aria-expanded={open === subject.subject}>
                  <ChevronRight size={14} aria-hidden className={open === subject.subject ? 'open' : ''} />
                  <strong>{subject.subject}</strong>
                  <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(subject.progress.score * 100)} aria-label={subject.subject}>
                    <span style={{ width: `${subject.progress.score * 100}%` }} />
                  </span>
                  <span className="st-faint small">
                    {/* Untouched topics count as zero, so this is not flattering. */}
                    {subject.progress.started} of {subject.progress.concepts} started
                    {subject.progress.confidence < 0.3 && subject.progress.started > 0 ? ' · still early' : ''}
                  </span>
                </button>
                {open === subject.subject ? (
                  <ul className="st-tree-chapters">
                    {subject.chapters.map((chapter) => (
                      <li key={chapter.chapter.id}>
                        <div className="st-tree-chapter">
                          <strong>{chapter.chapter.name}</strong>
                          {/*
                            * A test over the chapter, made only of the student's own cards and mistakes. When there
                            * is not enough of their own material, Orbis says so rather than writing questions.
                            */}
                          <button
                            type="button"
                            className="st-link"
                            onClick={() =>
                              void call<ChallengeShape | { ready: false; why: string }>('challenge', chapter.chapter.id).then((out) => {
                                if (out && 'questions' in out) setTest(out)
                                else onNotify((out as { why?: string })?.why ?? 'There is not enough of your own material yet.', 'warn')
                              })
                            }
                          >
                            <ListChecks size={13} aria-hidden /> Test me
                          </button>
                          <span className="st-faint small">
                            {chapter.progress.mastered > 0 ? `${chapter.progress.mastered} mastered · ` : ''}
                            {chapter.progress.weak > 0 ? `${chapter.progress.weak} weak · ` : ''}
                            {chapter.progress.untouched} not started
                          </span>
                        </div>
                        <ul className="st-tree-concepts">
                          {chapter.concepts.map((one) => (
                            <li key={one.concept.id} data-state={one.state}>
                              <span className="st-tree-dot" aria-hidden />
                              <span className="st-tree-name">{one.concept.name}</span>
                              <span className="st-faint small">{STATE_WORDS[one.state] ?? one.state}</span>
                              <button type="button" className="st-link" onClick={() => void begin(one.concept.id, one.concept.name, subject.subject, 20)}>
                                Start
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {working ? (
        <Socratic
          conceptId={working.conceptId}
          topic={working.name}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onClose={() => {
            setWorking(null)
            void load()
          }}
        />
      ) : null}

      {quizzing ? (
        <Quiz
          conceptId={quizzing.conceptId}
          topic={quizzing.name}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onClose={() => {
            setQuizzing(null)
            void load()
          }}
        />
      ) : null}

      {explained ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label={`About ${explained.name}`}>
          <div className="st-sheet-card">
            <header className="st-challenge-head">
              <div>
                <h3>{explained.name}</h3>
                {/* Said wherever written work appears. */}
                <p className="st-faint small">Written by Orion, for where you are stuck</p>
              </div>
              <button type="button" className="st-icon" aria-label="Close" onClick={() => setExplained(null)}>
                ×
              </button>
            </header>
            <p className="st-explained">{explained.text}</p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => setExplained(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {test ? (
        <Challenge
          challenge={test}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onClose={() => {
            setTest(null)
            void load()
          }}
        />
      ) : null}

      {proof ? (
        <div className="st-sheet" role="dialog" aria-label="Prove mastery">
          <div className="st-sheet-card tight">
            <h3>Proving it</h3>
            <p className="st-faint small">Mastery takes a mixture, so one good answer cannot claim it.</p>
            <ul className="st-proof">
              {proof.steps.map((step) => (
                <li key={step.label} className={step.done ? 'done' : ''}>
                  <span aria-hidden>{step.done ? '✓' : '○'}</span>
                  {step.label}
                </li>
              ))}
            </ul>
            {proof.passed ? <p>That is proven.</p> : <p className="st-faint">{proof.missing}</p>}
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setProof(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
