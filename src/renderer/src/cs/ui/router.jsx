/**
 * The routing the ported CS Studio needs, without react-router.
 *
 * Their studio is a rail of twenty-four sections and an `<Outlet />`, so unlike the physics port this cannot be
 * a no-op: every rail entry calls `NavLink`, and the shell renders whichever page the route names. So this is a
 * real router with one route at a time, held in React state — no URL and no history API, because a studio lives
 * inside a conversation rather than at an address, but a stack, so going back works.
 *
 * The same shape as the chemistry port's router, with `NavLink` and `Outlet` added because their shell uses both.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

const Where = createContext(null)
const Outlets = createContext(null)

/**
 * Wraps the studio.
 *
 * `pages` maps a route to what renders there, so `<Outlet />` has something to show. `start` is where it opens.
 */
export function Routed({ start = '/cs', pages = {}, resolve, children }) {
  const [stack, setStack] = useState([start])
  const at = stack[stack.length - 1]

  const navigate = useCallback((to, options = {}) => {
    if (typeof to === 'number') {
      // navigate(-1). Never past the first page: there is nothing behind the studio's own front page.
      setStack((was) => (was.length + to <= 0 ? was.slice(0, 1) : was.slice(0, was.length + to)))
      return
    }
    const next = String(to ?? '')
    if (next === '') return
    setStack((was) => {
      if (was[was.length - 1] === next) return was
      // `replace` is used by a redirect, which should not leave a step to go back to.
      return options.replace ? [...was.slice(0, -1), next] : [...was, next]
    })
  }, [])

  const where = useMemo(() => ({ at, navigate, deep: stack.length > 1 }), [at, navigate, stack.length])

  return (
    <Where.Provider value={where}>
      <Outlets.Provider value={{ pages, resolve }}>{children}</Outlets.Provider>
    </Where.Provider>
  )
}

/** Where the studio is, for a shell that needs to decide something itself. */
export function useWhere() {
  return useContext(Where)
}

export function useNavigate() {
  const here = useContext(Where)
  // Outside a Routed, navigating has nowhere to go; doing nothing beats throwing mid-render.
  return here?.navigate ?? (() => undefined)
}

export function useLocation() {
  const here = useContext(Where)
  const at = String(here?.at ?? '/')
  const cut = at.indexOf('?')
  return {
    pathname: cut === -1 ? at : at.slice(0, cut),
    search: cut === -1 ? '' : at.slice(cut),
    hash: '',
    state: null,
    key: at
  }
}

/**
 * The parameters in the current route.
 *
 * Their problem page is `/cs/problem/:slug`, so the last segment is the parameter. Handed back under every name
 * their pages read it by — getting this wrong does not throw, it hands back undefined and the page renders
 * empty, which is exactly how the chemistry element page broke.
 */
export function useParams() {
  const here = useContext(Where)
  const parts = String(here?.at ?? '').split('?')[0].split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  if (parts.length < 3) return {}
  return { slug: last, id: last, name: last }
}

export function useSearchParams() {
  const here = useContext(Where)
  const at = String(here?.at ?? '')
  const query = at.includes('?') ? at.slice(at.indexOf('?') + 1) : ''
  const params = useMemo(() => new URLSearchParams(query), [query])
  return [params, () => undefined]
}

/** Whatever the current route names. Their shell renders the rail and leaves the page to this. */
export function Outlet() {
  const here = useContext(Where)
  const held = useContext(Outlets) ?? {}
  const pages = held.pages ?? {}
  const at = String(here?.at ?? '').split('?')[0]
  /*
   * An exact lookup is not enough.
   *
   * A problem's address carries its slug -- `/cs/problem/two-sum` -- so an exact map misses every problem there
   * is, and the outlet quietly showed the "nothing here" page instead. `resolve` is given by the shell and gets
   * first refusal, so a route with a parameter in it can be matched.
   */
  const What = (typeof held.resolve === 'function' ? held.resolve(at) : null) ?? pages[at] ?? pages['*'] ?? null
  if (!What) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        There is nothing at {at} yet.
      </div>
    )
  }
  return <What />
}

export function Link({ to, children, className = '', onClick, ...rest }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) navigate(to)
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * A link that knows whether it is the current one.
 *
 * Their rail uses the function form of `className` and of `children`, so both are supported — `end` means the
 * route has to match exactly, which is what stops `/cs` looking active on every page beneath it.
 */
export function NavLink({ to, children, className, end = false, ...rest }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const target = String(to ?? '').split('?')[0]
  const isActive = end ? pathname === target : pathname === target || pathname.startsWith(target + '/')
  const state = { isActive, isPending: false, isTransitioning: false }
  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      className={typeof className === 'function' ? className(state) : className}
      onClick={() => navigate(to)}
      {...rest}
    >
      {typeof children === 'function' ? children(state) : children}
    </button>
  )
}

/** Present because a page may render one; it moves the route and draws nothing. */
export function Navigate({ to, replace = false }) {
  const navigate = useNavigate()
  React.useEffect(() => {
    navigate(to, { replace })
  }, [navigate, to, replace])
  return null
}

export default { Routed, useWhere, useNavigate, useLocation, useParams, useSearchParams, Outlet, Link, NavLink, Navigate }
