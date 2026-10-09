/**
 * The small amount of routing the ported chemistry pages need, without react-router.
 *
 * Unlike the physics port, this one cannot be a no-op. Their Chemistry Studio is a hub: it lists twenty-six
 * modules and every one of them is reached by `navigate('/chemistry/kinetics')`. A `navigate` that did nothing
 * would leave every tile on the hub dead, which is exactly the kind of thing that looks finished and is not.
 *
 * So this is a real router with one route at a time, held in React state and provided through context. There is
 * no URL and no history API — a laboratory lives inside a conversation, not at an address — but there is a stack,
 * so going back works and `navigate(-1)` means what their pages expect it to mean.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

const Where = createContext(null)

/** Wraps the studio. Everything inside can navigate; nothing outside is affected. */
export function Routed({ start = '/chemistry', children }) {
  const [stack, setStack] = useState([start])
  const at = stack[stack.length - 1]

  const navigate = useCallback((to) => {
    if (typeof to === 'number') {
      // navigate(-1) and friends. Never past the first page: there is nothing behind the hub.
      setStack((was) => (was.length + to <= 0 ? was.slice(0, 1) : was.slice(0, was.length + to)))
      return
    }
    const next = String(to ?? '')
    if (next === '') return
    setStack((was) => (was[was.length - 1] === next ? was : [...was, next]))
  }, [])

  const value = useMemo(() => ({ at, navigate, deep: stack.length > 1 }), [at, navigate, stack.length])
  return <Where.Provider value={value}>{children}</Where.Provider>
}

/** Where the studio is, for the shell that decides what to render. Null outside a `Routed`. */
export function useWhere() {
  return useContext(Where)
}

export function useNavigate() {
  const here = useContext(Where)
  // Outside a Routed -- a page rendered on its own -- navigating has nowhere to go, and saying so by doing
  // nothing is better than throwing in the middle of a render.
  return here?.navigate ?? (() => undefined)
}

export function useLocation() {
  const here = useContext(Where)
  const at = String(here?.at ?? '/')
  const cut = at.indexOf('?')
  // The path without its query, and the query separately -- the shape their pages expect from a real router.
  return { pathname: cut === -1 ? at : at.slice(0, cut), search: cut === -1 ? '' : at.slice(cut), hash: '', state: null }
}

/**
 * The parameters in the current route.
 *
 * Their element page navigates to `/chemistry/element/123` and reads the number back as `atomicNumber`. The name
 * is the page's to choose, not this shim's, so every name their pages actually read is handed back -- getting
 * this wrong does not throw, it hands back undefined, and the page renders empty. Which is what happened:
 * clicking any element in the periodic table opened a page with nothing on it.
 */
export function useParams() {
  const here = useContext(Where)
  const at = String(here?.at ?? '')
  const parts = at.split('?')[0].split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  if (/^\d+$/.test(last)) {
    // One number, under every name their pages ask for it by.
    return { atomicNumber: last, z: last, number: last, id: last }
  }
  // A symbol or a name, for the pages that are reached by one.
  if (parts.length > 2 && /^[A-Za-z][A-Za-z-]*$/.test(last)) return { symbol: last, name: last, id: last }
  return {}
}

/**
 * The query string of the current route, as a read-only URLSearchParams.
 *
 * Their Combination Engine reads `?focus=` from it to pre-select an element. Routes here can carry a query the
 * same way a URL does, so this parses it rather than always handing back an empty one -- an empty one would make
 * the focus silently never arrive.
 *
 * The setter is present and does nothing, because nothing in the ported pages writes to it.
 */
export function useSearchParams() {
  const here = useContext(Where)
  const at = String(here?.at ?? '')
  const query = at.includes('?') ? at.slice(at.indexOf('?') + 1) : ''
  const params = useMemo(() => new URLSearchParams(query), [query])
  return [params, () => undefined]
}

export function Link({ to, children, className = '', ...rest }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className={`jx-link ${className}`.trim()}
      onClick={() => navigate(to)}
      {...rest}
    >
      {children}
    </button>
  )
}

export default { useNavigate, useLocation, useParams, useSearchParams, Link, Routed, useWhere }
