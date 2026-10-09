/**
 * The page heading the ported pages expect.
 *
 * The original sets the browser tab's title and draws a heading with a subtitle and a slot for actions. Inside a
 * lab card there is no tab to set, but the subtitle is worth keeping — it is where the studio says what it is —
 * so this renders the heading and whatever was passed as children. An earlier version returned null and quietly
 * dropped both.
 */
export default function PageTitle({ title, subtitle, children }) {
  return (
    <div className="jx-pagetitle">
      <div className="jx-pagetitle-text">
        {title ? <h3>{title}</h3> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="jx-pagetitle-actions">{children}</div> : null}
    </div>
  )
}
