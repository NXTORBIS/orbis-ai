/**
 * A section whose laboratory is one of Orbis's own rather than one of theirs.
 *
 * NOT the user's file.
 *
 * Their rail has twenty-four entries and twenty-three have a page in this port. Digital Logic is the exception:
 * it pointed at a separate page of theirs that was deliberately left out, and Orbis has its own Digital Logic
 * Laboratory which does more — gates, adders, flip-flops, counters, a truth table and Boolean simplification.
 *
 * Rather than port a thinner version or leave the entry dead, the entry says plainly where the real thing is and
 * opens it. One subject, one place, and the better of the two.
 */
import React, { useState } from 'react'
import { ExternalLink, Binary, Database } from 'lucide-react'
import { useLocation } from './ui/router.jsx'

/** Which Orbis laboratory answers for a section, and what it does that the ported one would not. */
const ELSEWHERE = {
  'digital-logic': {
    appId: 'logic-lab',
    title: 'Digital Logic Laboratory',
    says: 'Orbis has its own, and it goes further than this studio would: logic gates and whole circuits, adders, flip-flops and counters, a truth table built from what you wired, and the Boolean expression reduced.',
    icon: Binary
  },
  databases: {
    appId: 'sql-lab',
    title: 'Database Laboratory',
    says:
      'Orbis has its own, and it goes further: it runs your SQL against a real database in the application rather ' +
      'than fetching a WebAssembly engine from the internet, so it works offline — and it shows you the schema and ' +
      'explains what the query planner did, including when it had to scan a whole table.',
    icon: Database
  }
}

/** Which section is being shown, worked out from the route, because the outlet renders this with no props. */
const FOR_ROUTE = {
  '/digital-logic-lab': 'digital-logic',
  '/cs/databases': 'databases'
}

export default function Elsewhere({ which }) {
  const { pathname } = useLocation()
  const one = ELSEWHERE[which ?? FOR_ROUTE[pathname] ?? 'digital-logic']
  const [refused, setRefused] = useState(null)
  const [opening, setOpening] = useState(false)

  if (!one) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">
        Nothing is set up for this section.
      </div>
    )
  }

  const open = async () => {
    const api = typeof window !== 'undefined' ? window.api : null
    if (!api || typeof api.native !== 'function') {
      setRefused('This cannot be opened from here.')
      return
    }
    setOpening(true)
    setRefused(null)
    try {
      const made = await api.native('open', { appId: one.appId })
      // `open` reports what happened rather than throwing, so a refusal is read rather than caught.
      if (made && made.ok === false) setRefused(made.says ?? 'It would not open.')
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error))
    } finally {
      setOpening(false)
    }
  }

  const Icon = one.icon

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-cyan-j/15 text-cyan-j">
        <Icon className="size-6" />
      </div>
      <div className="font-display text-lg font-semibold">{one.title}</div>
      <p className="max-w-lg text-sm text-muted-foreground">{one.says}</p>
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="flex items-center gap-2 rounded-xl bg-cyan-j px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        <ExternalLink className="size-4" />
        {opening ? 'Opening…' : 'Open it'}
      </button>
      {refused && (
        <p className="max-w-lg text-[11px] text-amber-400">
          {refused}
        </p>
      )}
      <p className="max-w-lg text-[11px] text-muted-foreground/70">
        It opens as its own laboratory in the conversation, beside this studio.
      </p>
    </div>
  )
}
