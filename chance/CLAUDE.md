# Orbis Chance — working notes

An independent probability, simulation and uncertainty exploration platform.
React 18 + TypeScript + Vite. Everything runs in the browser; there is no
server, no account and no API key.

## Commands

```bash
npm run dev        # development server on :5173
npm run check      # typecheck + lint + unit tests + build (run before finishing)
npm test           # vitest (unit, property-based, integration)
npm run test:e2e   # Playwright; set PLAYWRIGHT_CHROMIUM_PATH if needed
```

**`npx tsc --noEmit` on its own checks nothing.** The root `tsconfig.json` is
a solution file with `"files": []`, so it exits zero having read no source at
all.

There are two projects, and `-p tsconfig.app.json` is only one of them:
`src/` is the app project, while `e2e/`, `vite.config.ts` and the scripts are
the node project, which has a different target. A `for (const x of
document.querySelectorAll(...))` in a Playwright spec typechecks under the
app project and fails under the node one, which is exactly how a broken
`npm run build` reached the end of a session whose every typecheck had
"passed".

So: `npx tsc -b` (or `npm run check`, which runs it) is the check that
covers everything. `npx tsc --noEmit -p tsconfig.app.json` is the faster
inner-loop check for `src/` alone — useful, but never the last word. Add
`--incremental false` if a stale `tsbuildinfo` reports errors for files that
no longer exist.

## Architecture rules

These boundaries are deliberate. Keep them.

- **`src/engine/` imports nothing from `src/ui/`, `src/app/` or `src/ai/`.**
  There is a test asserting the AI part of this (`src/ai/contract.test.ts`).
- **`src/ai/` must never gain a provider client, an API key, or a network
  call.** It is a typed contract only. A test greps for this.
- Chart components receive computed values; they never compute results.
- Simulation models are serialisable configurations looked up by id from
  `src/engine/simulation/registry.ts`, so the same code runs on the main
  thread, in the worker and in tests. Add new models there.
- Heavy engine jobs follow the same pattern through
  `src/engine/jobs/registry.ts`: a job is a generator yielding between chunks,
  so it runs in the worker, on the main thread as a fallback, and in tests
  unchanged. `src/app/shared/useEngineJob.ts` drives it. An `EngineError` must
  cross the worker boundary as its `Issue[]` — an `Error` subclass loses its
  class through `postMessage`, and a refusal arriving as `[object Object]` is a
  correctness failure, not a cosmetic one.
- A tool screen exports exactly three things: `XConfig`, `X_DEFAULT` and
  `XTool({config})`. Adding one means four registries — `TOOL_IDS` in
  `src/persistence/schema.ts`, the `TOOLS` entry in `src/app/tools.ts`, and
  both tables in `src/app/tools/lazy.ts`. `src/app/catalogue.test.ts` asserts
  they agree; only one of the four omissions is caught by the compiler.
- **Nothing may statically import a tool module.** Every screen is code-split,
  and one static import of one tool's default configuration pulls all
  forty-two screens into the entry chunk. This has regressed twice. The
  examples library holds a `configOverride` and resolves the default through
  the same dynamic import as the screen.
- A tool's catalogue `methods` array is what search matches on, so list the
  eponym people actually type — "Metropolis-Hastings", not "Random-walk
  Metropolis". Never list a method the screen cannot actually run.

## Correctness expectations

- Never return a plausible-looking number. If a computation fails or an input
  is insufficient, return an `EngineError` with a message that says what is
  missing. Never substitute 0 or NaN silently.
- Every engine result distinguishes `exact` / `numerical` / `empirical` /
  `assumed`, and the interface shows that label.
- New distributions or statistical methods need reference values from an
  independent source. Use `scripts/generate_reference_values.py` (SciPy) or
  add a comparable check; do not assert against this codebase's own output.
- Keep the distinction between a confidence interval for an estimate and
  percentiles of simulated outcomes. They are different statements and the
  interface labels them separately.
- Do not assume independence anywhere by default. Where a relationship is
  unknown, report bounds.
- Anything costing more than roughly 300 ms sits behind an opt-in `runX:
  boolean` field defaulting to `false`, with a notice stating the cost. Two
  screens once froze the tab for fourteen seconds on open, and a branching
  simulation blocked it for nine minutes with its own cancel button visible
  and unclickable. A field maximum that blocks the main thread for seconds is
  a defect even when the default is fast.
- A validation message is not enough on its own: a field must not report a
  value upward that it has just declared invalid. `NumberField` did exactly
  that, so every `min` and `max` in the application was decoration.

## Simulation and the worker

The runner is a generator (`simulationSteps`) that yields between chunks of
trials. This is what makes cancellation work: a worker blocked in a
synchronous loop can never receive a `cancel` message, and `SharedArrayBuffer`
is unavailable unless the page is cross-origin isolated. If you change the
runner loop, keep the yield.

## Measuring the interface

Two whole classes of defect were invisible to tests that looked plausible:

- A page-level overflow assertion cannot see clipped content. `.oc-content`
  clips with `overflow-x: hidden`, so `documentElement.scrollWidth` equals the
  viewport however wide the cards are — twenty-six of the forty-two screens
  were rendering cards up to 1,974 px wide at phone width and the suite passed.
  Measure the elements.
- A screen that paints is not a screen that works. The paint-budget test
  catches a frozen first render; it says nothing about what happens when a
  button is pressed. Drive the real browser: click every button, exercise every
  mode of a mode-switching screen, cancel mid-run, and poll a heartbeat to
  measure the longest main-thread gap.

## Tests

2,967 unit/integration tests in 46 files, and 54 Playwright tests across four
specs (journeys and the per-tool paint budget, main-thread responsiveness,
report export, and phone width). Distribution values are
checked against SciPy fixtures in
`src/engine/distributions/__fixtures__/scipy-reference.json`; regenerate with
`python3 scripts/generate_reference_values.py` (needs scipy).
