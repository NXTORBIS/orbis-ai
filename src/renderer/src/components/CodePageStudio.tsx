import { useEffect, useRef, useState } from 'react'
import { Loader2, PenLine, ShieldAlert, X } from 'lucide-react'
import CodePageView from './CodePageView'
import { Surface } from '../ui'

/**
 * Asking Orbis to write a Page, and watching it run.
 *
 * The other route builds a calculator out of engines Orbis tested before the Page existed. This one writes a web page,
 * and nothing checks that what it shows is right -- so the screen says so, every time, next to the Page rather than
 * buried in a help article. A person looking at a number needs to know which kind of Page produced it.
 *
 * The Page itself is not in this document. It is a sandboxed frame the main process places over the rectangle this
 * screen reserves, which is why the area below is empty markup: everything in it is drawn by something else.
 */

interface Built {
  pageId: string
  title: string
  purpose: string
  notes: readonly string[]
  /** Warnings that did not stop it being built, kept because a Page that works can still be worth a caveat. */
  problems: string[]
}

export default function CodePageStudio({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [request, setRequest] = useState('')
  const [working, setWorking] = useState(false)
  const [built, setBuilt] = useState<Built | null>(null)
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<{ message: string; problems: string[] } | null>(null)
  const openedId = useRef<string | null>(null)

  /*
   * A Page that is open when this screen goes away is closed with it.
   *
   * The frame belongs to the main process, not to this component, so nothing tidies it up on its own: leaving would
   * otherwise leave a Page running over whatever replaced this screen, still animating, with nothing explaining it.
   */
  useEffect(() => {
    return () => {
      if (openedId.current !== null) void window.api.pagesCodeClose(openedId.current)
    }
  }, [])

  const build = async (): Promise<void> => {
    const words = request.trim()
    if (words === '' || working) return

    if (openedId.current !== null) {
      await window.api.pagesCodeClose(openedId.current)
      openedId.current = null
      setOpen(false)
    }

    setWorking(true)
    setFailure(null)
    setBuilt(null)
    try {
      const result = await window.api.pagesCodeBuild(words)
      if (!result.ok || !result.pageId) {
        setFailure({
          message: result.message ?? 'This could not be written as a Page.',
          // What was actually wrong with each attempt, rather than a shrug. It is usually specific and usually useful.
          problems: result.attempts?.flatMap((a) => a.problems) ?? result.problems ?? []
        })
        return
      }

      const made: Built = {
        pageId: result.pageId,
        title: result.title ?? 'Page',
        purpose: result.purpose ?? '',
        notes: result.notes ?? [],
        problems: result.problems ?? []
      }
      setBuilt(made)

      const opened = await window.api.pagesCodeOpen(made.pageId)
      if (opened.ok) {
        openedId.current = made.pageId
        setOpen(true)
      } else {
        setFailure({ message: opened.message ?? 'It was written but would not open.', problems: [] })
      }
    } finally {
      setWorking(false)
    }
  }

  const close = async (): Promise<void> => {
    if (openedId.current === null) return
    await window.api.pagesCodeClose(openedId.current)
    openedId.current = null
    setOpen(false)
  }

  return (
    <Surface
      title={built ? built.title : 'Write a Page'}
      /*
       * The region keeps the name it has always had rather than following the built Page's title: the heading says
       * which Page you are looking at, and the name says which screen you are on. They are not the same question.
       */
      label="Write a Page"
      /* The way out of this screen goes back to the library, which is where it came from. */
      closeLabel="Back to Pages"
      onClose={onBack}
      className="pages-view"
      actions={
        /* Closes the Page without leaving the screen, so it is only there while one is open. */
        open ? (
          <button type="button" className="queue-btn small ghost" onClick={() => void close()}>
            <X size={13} /> Close this Page
          </button>
        ) : null
      }
    >
      <div className="code-page-studio">
        <form
          className="code-page-ask"
          onSubmit={(e) => {
            e.preventDefault()
            void build()
          }}
        >
          <label className="pages-search code-page-input">
            <PenLine size={14} />
            <input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Describe the Page you want — a simulation, a chart, a tool, a game"
              aria-label="Describe the Page you want"
              disabled={working}
            />
          </label>
          <button type="submit" className="queue-btn primary" disabled={working || request.trim() === ''}>
            {working ? <Loader2 size={13} className="spin" /> : <PenLine size={13} />}
            {working ? 'Writing…' : 'Write it'}
          </button>
        </form>

        {/*
          Said next to the Page, every time, rather than once in a help article.
          Orbis has two kinds of Page and only one of them is about correctness. Somebody reading a number off this one
          needs to know which kind produced it, at the moment they are reading it.
        */}
        <p className="code-page-caveat">
          <ShieldAlert size={13} /> A Page written as code can do anything a web page can, and nothing here checks that
          what it works out is right. Pages built from Orbis’s own calculations are checked; this kind is not.
        </p>

        {failure && (
          <section className="code-page-failure" aria-label="Why it could not be written">
            <p>{failure.message}</p>
            {failure.problems.length > 0 && (
              <ul>
                {failure.problems.slice(0, 6).map((one, i) => (
                  <li key={i}>{one}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {built && (
          <section className="code-page-about" aria-label="About this Page">
            {built.purpose !== '' && <p className="code-page-purpose">{built.purpose}</p>}
            {built.notes.length > 0 && (
              <ul className="code-page-notes">
                {built.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            {/* Warnings that did not stop it being built. Shown rather than swallowed: it works and still has a caveat. */}
            {built.problems.length > 0 && (
              <ul className="code-page-warnings">
                {built.problems.map((one, i) => (
                  <li key={i}>{one}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/*
          Where the Page goes. Empty on purpose: the frame is the main process's, placed over this rectangle, so there
          is nothing here to draw. It is kept mounted while a Page is open and measured continuously, because the
          rectangle moves whenever anything above it changes size.
        */}
        <CodePageView hidden={!open} />
      </div>
    </Surface>
  )
}
