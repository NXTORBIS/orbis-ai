/**
 * The two things the ported pages take from react-router-dom.
 *
 * Orbis has no router: a lab lives inside a conversation, not at a URL, so there is nowhere to navigate to. Rather
 * than edit the pages, these keep the same shape and do nothing — which is honest. A `navigate` that silently went
 * somewhere else, or a link that looked live and was not, would both be worse.
 *
 * The one place it matters is the studio's Back button, which calls `navigate(-1)` to leave the page. Inside a lab
 * card there is nothing to go back to, and the studio's own "All topics" button already does the only going back
 * that exists here.
 */
export function useNavigate() {
  return () => undefined
}

export function Link({ to, children, className = '', ...rest }) {
  return (
    <span className={`jx-link ${className}`.trim()} data-to={to} {...rest}>
      {children}
    </span>
  )
}

/** Present so a page asking for the current location gets something sane rather than throwing. */
export function useLocation() {
  return { pathname: '/', search: '', hash: '', state: null }
}

export function useParams() {
  return {}
}

export default { useNavigate, Link, useLocation, useParams }
