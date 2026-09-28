import { useCallback, useEffect, useState } from 'react'
import type { CapabilityDescriptor, ControlDomain } from '../../../shared/browserControl'
import { Toggle } from './SettingsModal'

/** Plain names for the kinds of thing Orbis can do, in the order most people care about. */
const KINDS: { domain: ControlDomain; label: string; about: string }[] = [
  { domain: 'tabs', label: 'Tabs and groups', about: 'Open, close and switch between tabs' },
  { domain: 'navigation', label: 'Going to pages', about: 'Open addresses, go back and forward, reload' },
  { domain: 'page', label: 'Using pages', about: 'Read a page, click, type and scroll on it' },
  { domain: 'find', label: 'Finding on a page', about: 'Search the text of the page you are on' },
  { domain: 'downloads', label: 'Downloads', about: 'Start downloads and look at them' },
  { domain: 'bookmarks', label: 'Bookmarks', about: 'Add, change and remove bookmarks' },
  { domain: 'history', label: 'History', about: 'Look through and clear browsing history' },
  { domain: 'clipboard', label: 'Clipboard', about: 'Copy from and paste into the clipboard' },
  { domain: 'notes', label: 'Notes', about: 'Create and change notes' },
  { domain: 'tasks', label: 'Tasks', about: 'Create and change tasks' },
  { domain: 'whiteboard', label: 'Whiteboard', about: 'Put things on whiteboards' },
  { domain: 'workspaces', label: 'Workspaces', about: 'Save and open sets of tabs' },
  { domain: 'workflows', label: 'Workflows', about: 'Run saved workflows and skills' },
  {
    domain: 'markets',
    label: 'Markets',
    // What switching it off stops, and what it never could have done: the distinction is the point of the sentence.
    about: 'Read prices, screen markets, set alerts and place simulated paper trades. Never a real order — Orbis holds no exchange credentials'
  },
  { domain: 'experience', label: 'New tab and widgets', about: 'Change your widgets, theme and wallpaper' },
  // Locking things and reading what is protected. Switching this off does not weaken a lock: a locked tab is refused
  // whatever this says, because that refusal is not a capability and has no switch.
  { domain: 'security', label: 'Locking tabs and Orbis', about: 'Lock protected tabs, lock Orbis, and see what is protected' },
  { domain: 'settings', label: 'Orbis settings', about: 'Change how Orbis itself is set up' },
  { domain: 'permissions', label: 'Site permissions', about: 'Allow or block camera, location and the like' },
  { domain: 'extensions', label: 'Extensions', about: 'Install, switch off and remove extensions' },
  { domain: 'devtools', label: 'Developer tools', about: 'Open developer tools and run page scripts' },
  { domain: 'profiles', label: 'Profiles', about: 'Create and switch profiles' },
  { domain: 'window', label: 'The Orbis window', about: 'Resize, move and full-screen the window' }
]

/**
 * Settings → What Orion may do.
 *
 * These decide what Orbis may do *on your behalf* — Orion, skills, workflows and step-by-step runs. Switching a kind off
 * takes it out of what they can even see, so nothing is planned around it, and refuses it if something tries anyway.
 * What you do yourself in Orbis is never affected.
 */
export default function ControlSwitches(): React.JSX.Element {
  const [off, setOff] = useState<ControlDomain[] | null>(null)
  const [have, setHave] = useState<Set<ControlDomain>>(new Set())

  const load = useCallback(() => {
    void window.api.controlSwitches().then(setOff)
    void window.api
      .getControlCapabilities({})
      .then((caps: CapabilityDescriptor[]) => setHave(new Set(caps.map((c) => c.domain))))
      .catch(() => undefined)
  }, [])
  useEffect(load, [load])

  if (!off) return <p className="setting-note">Loading…</p>
  const kinds = KINDS.filter((k) => have.size === 0 || have.has(k.domain))

  return (
    <div className="skills-settings">
      <p className="setting-note">
        These decide what Orbis may do for you — Orion, skills, workflows and step-by-step runs. Anything switched off is
        hidden from them and refused if something tries it. What you do yourself is never affected.
      </p>
      {kinds.map((kind) => (
        <div key={kind.domain} className="skills-row">
          <span>
            {kind.label}
            <small className="skill-meta"> · {kind.about}</small>
          </span>
          <Toggle
            checked={!off.includes(kind.domain)}
            onChange={(on) => {
              setOff((now) => (now ? (on ? now.filter((d) => d !== kind.domain) : [...now, kind.domain]) : now))
              void window.api.setControlSwitch(kind.domain, on).then(setOff)
            }}
          />
        </div>
      ))}
    </div>
  )
}
