/**
 * Their in-browser JavaScript runner, removed on purpose.
 *
 * NOT the user's file. Theirs ran the person's JavaScript **in this window**, and fetched Sucrase from
 * `esm.sh` at runtime to transpile TypeScript first. Running arbitrary JavaScript in the renderer is the worst
 * version of this problem: the code does not merely share a process with Orbis, it shares a global scope with
 * `window.api` — the bridge to the secrets vault, the file pickers, the browser and every profile. A program
 * somebody pasted in to try could read all of it.
 *
 * It also broke Orbis's one hard rule: code goes to a remote sandbox, or to a model that reads it, and there is
 * no third route.
 *
 * ## What was lost, stated rather than hidden
 *
 * Theirs could pause on `input()` and wait for somebody to type. That is gone. The input is now given before the
 * run, in the panel beside the editor, one value per line.
 *
 * These functions stay so their pages need no editing, and each says plainly why it will not run.
 */

const REFUSAL =
  'JavaScript is not run inside this window — a program running here would share a scope with Orbis’s own ' +
  'bridge to your vault and files. Orbis sends code to a sandbox, or has Orion read it. Type the input in the ' +
  'panel beside the editor and press Run.'

/** Their interactive entry point. Reports the refusal through the handlers their console already listens to. */
export async function runJsInteractive(_code, handlers = {}) {
  handlers.onError?.(REFUSAL)
  handlers.onDone?.({ status: 'unavailable', message: REFUSAL })
  return { status: 'unavailable', message: REFUSAL }
}

/** Present because their playground checks it before offering the interactive path. */
export const jsReady = () => false

export default { runJsInteractive, jsReady }
