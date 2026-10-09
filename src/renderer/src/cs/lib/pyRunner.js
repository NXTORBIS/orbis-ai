/**
 * Their in-browser Python runner, removed on purpose.
 *
 * NOT the user's file. Theirs loaded Pyodide from `cdn.jsdelivr.net` at runtime and ran the person's Python **in
 * this window's main thread** — the same window that holds `window.api`, which is the bridge to the secrets
 * vault, the file pickers, the browser and every other profile. Arbitrary code sharing a global scope with that
 * bridge is not something to ship, whatever it is convenient for.
 *
 * It also broke Orbis's one hard rule about running code: it goes to a remote sandbox, or it goes to a model
 * that reads it, and there is no third route. Not in a subprocess, not in a worker, not in WebAssembly in the
 * renderer.
 *
 * ## What was lost, stated rather than hidden
 *
 * Theirs could pause on `input()` and wait for somebody to type — real interactive stdin. That is genuinely nice
 * and it is gone. In its place the input is given before the run, in the panel beside the editor, one value per
 * line. For a studio where you write a program and see what it prints, that is the honest trade.
 *
 * These functions stay so their pages need no editing, and each says plainly why it will not run.
 */

const REFUSAL =
  'Python is not run inside this window. Orbis sends code to a sandbox, or has Orion read it — nothing is ever ' +
  'executed on this computer. Type the input in the panel beside the editor and press Run.'

/** Their interactive entry point. Reports the refusal through the handlers their console already listens to. */
export async function runPythonInteractive(_code, handlers = {}) {
  handlers.onError?.(REFUSAL)
  handlers.onDone?.({ status: 'unavailable', message: REFUSAL })
  return { status: 'unavailable', message: REFUSAL }
}

/** Present because their playground checks it before offering the interactive path. */
export const pythonReady = () => false

export const loadPython = async () => {
  throw new Error(REFUSAL)
}

export default { runPythonInteractive, pythonReady, loadPython }
