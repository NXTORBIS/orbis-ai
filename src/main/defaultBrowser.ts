import { app, shell } from 'electron'

/**
 * Whether Orbis is the browser Windows opens links with.
 *
 * Windows decides this, not Orbis. Since Windows 10 an application cannot make itself the default: it can register
 * itself as able to handle http and https, and it can open the page where the user chooses. Anything that claims to
 * have set it without the user choosing is either lying or was written before Windows 8.
 *
 * So this asks Windows what is true, registers Orbis as a candidate, and opens the chooser. It never reports success
 * it has not been told about: after the chooser closes, Windows is asked again.
 */

export type DefaultBrowserState = {
  /** What Windows says right now. */
  isDefault: boolean
  /** Whether Orbis can ask at all — false in a dev run, where there is no registered application to choose. */
  canAsk: boolean
  /** Said plainly when Orbis cannot be the default here, rather than offering a button that would do nothing. */
  why?: string
}

/** The schemes a browser has to handle to be one. */
const SCHEMES = ['http', 'https'] as const

/**
 * What Windows currently says.
 *
 * Both schemes have to be Orbis: a browser that opens http but not https is not the default browser, and saying it is
 * would be the kind of small lie that makes the rest untrustworthy.
 */
export function readDefaultBrowser(): DefaultBrowserState {
  // A development run is not an installed application, so Windows has nothing to make default.
  if (!app.isPackaged) {
    return { isDefault: false, canAsk: false, why: 'A development build cannot be made the default browser. An installed Orbis can.' }
  }
  if (process.platform !== 'win32') {
    return { isDefault: SCHEMES.every((scheme) => app.isDefaultProtocolClient(scheme)), canAsk: false, why: 'Set the default browser in your system settings.' }
  }
  return { isDefault: SCHEMES.every((scheme) => app.isDefaultProtocolClient(scheme)), canAsk: true }
}

/**
 * Registers Orbis as something Windows may open links with, and opens the place the user chooses.
 *
 * Registering is not becoming the default; it is being on the list. The choice is the user's and is made in Windows'
 * own settings, which is why this opens them rather than pretending to have made it.
 */
export async function requestDefaultBrowser(): Promise<DefaultBrowserState> {
  const state = readDefaultBrowser()
  if (!state.canAsk) return state

  for (const scheme of SCHEMES) {
    // Harmless when it is already registered.
    app.setAsDefaultProtocolClient(scheme)
  }
  await openDefaultAppsSettings()
  // Windows has not been answered yet; what is true is still what was true.
  return readDefaultBrowser()
}

/** Opens the Windows page where default applications are chosen, at Orbis where Windows supports it. */
export async function openDefaultAppsSettings(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  // Windows 11 opens an application's own page; Windows 10 ignores the argument and opens the list, which is fine.
  const target = `ms-settings:defaultapps?registeredAppMachine=${encodeURIComponent(app.getName())}`
  try {
    await shell.openExternal(target)
    return true
  } catch {
    try {
      await shell.openExternal('ms-settings:defaultapps')
      return true
    } catch {
      return false
    }
  }
}
