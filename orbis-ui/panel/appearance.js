import { call } from './helper.js'

/**
 * How Orbis looks, worn by the browser's own pages.
 *
 * The browser and the chat are two halves of one application, and until now only one of them knew what the person had
 * chosen: a theme, an accent, a corner radius or a whole preset picked in Settings reached the chat and stopped at the
 * edge of the browser, so a new tab was a different product from the window that opened it.
 *
 * The variables are built by the chat, with the same shared function the chat itself uses, and simply applied here.
 * Nothing about what a preset means is decided twice.
 *
 * ## What it will not do
 *
 * **It never invents a look.** With no answer from Orbis the page keeps the one it was built with, which is Orbis's
 * own default -- not a half-applied theme, and not a flash of something else.
 *
 * **It never asks once and gives up.** These pages are created with the browser window, which is earlier than the
 * helper they have to ask, so a single attempt would nearly always miss.
 */

let applied = ''

/**
 * The starfield, when the look asks for one.
 *
 * Loaded only then: a page wearing a flat background has no use for the drawing and should not pay for the module.
 * It is the same drawing the chat uses -- `shared/backdrop.ts` -- rather than a second one that would drift from it.
 */
async function setField(wanted, still) {
  try {
    const module = await import('./backdrop-mount.js')
    module.setBackdrop(wanted, still)
  } catch {
    // No starfield is a plain background, which is a look Orbis already has. Nothing is said about it.
  }
}

/** Puts the variables on the document, and names the backdrop the preset asked for. */
function wear(look) {
  const root = document.documentElement
  const variables = (look && look.variables) || {}
  /*
   * Only what is given is set, and what was set before is removed.
   *
   * Switching from a preset that paints a background to one that does not has to actually take the old background
   * off, or the page keeps wearing half of something nobody chose.
   */
  const next = Object.keys(variables).join('|')
  if (next === applied && !look.backdrop) return
  for (const name of applied.split('|')) {
    if (name && !(name in variables)) root.style.removeProperty(name)
  }
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  applied = next

  if (look && look.backdrop) root.dataset.backdrop = look.backdrop
  else delete root.dataset.backdrop

  /*
   * The field the chat draws, drawn here too.
   *
   * `field` is the chat's own "visual effects" setting, which is what decides it there -- not a preset. Reduced
   * motion keeps the stars and stops the drift, because the stars are the look and the drift is the preference.
   */
  void setField(look ? look.field !== false : false, Boolean(look && look.still))
}

/** Reads it, and keeps asking until Orbis answers. */
export async function followAppearance() {
  for (let wait = 400; ; wait = Math.min(wait * 1.6, 10_000)) {
    try {
      const look = await call('appearance:get', [])
      if (look && typeof look === 'object') {
        wear(look)
        return
      }
    } catch {
      // Orbis is not up yet, or has no appearance to give. Either way the page keeps the look it was built with.
    }
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

/** Orbis calls this when the look changes, so a preset chosen in Settings reaches an open browser without a reload. */
globalThis.orbisAppearanceChanged = () => void followAppearance()
