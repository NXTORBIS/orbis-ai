# Phase 2 — Computing and Mathematics

What was built, what was deliberately not, and why. This describes the code that exists.

---

## 1. The two findings that set the scope

**Finding one: Orbis already has the mathematics.** `src/shared/compute/` holds about 13,000 lines of real,
tested engines — a safe expression parser (no `eval`), calculus, linear algebra, statistics, optimisation, solvers,
interpolation, plotting, geometry, and graph algorithms. `node:sqlite` is available and already used by
`main/knowledge/`. So the mathematics and database halves of Phase 2 need *applications*, not engines.

**Finding two: Orbis cannot execute Python, C, C++ or Java, and must not pretend to.** There is no language runtime
in the build, no process sandbox for native code, and a standing instruction that generated code is never executed
on the host. The brief agrees with that conclusion in its own words:

> §316 **NO FAKE LANGUAGE SUPPORT.** If a runtime cannot be packaged safely and correctly: do not advertise it as
> supported.
> §317 **NO FAKE DEBUGGER.** §318 **NO FAKE PROFILER.** §383 Is this actually functional? If not, do not present it
> as implemented.

So the Code Laboratory as specified — compiler, terminal, debugger, breakpoints, call stack, profiler, package
installation for six languages — is not buildable here, and no part of it was faked. Section 6 says what *is*
possible instead.

---

## 2. What was built

### 2.1 The algorithm engine — `src/shared/algorithms/`

A complete traced-execution engine. 71 tests.

| File | What it is |
|---|---|
| `trace.ts` | The recording model: `Step`, `Counts`, `Frame`, `Run`, the `Recorder`, replay helpers, seeded randomness. |
| `sorting.ts` | Eight sorts, each written out and emitting its own trace: bubble, insertion, selection, merge, quick (five pivot strategies), heap, counting, radix. |
| `searching.ts` | Linear, binary, interpolation, jump. |
| `graphs.ts` | BFS, DFS, Dijkstra, Bellman-Ford, A*, Kruskal, topological sort — traced. |
| `dynamic.ts` | 0/1 knapsack, longest common subsequence, longest increasing subsequence, and Fibonacci run both naively and with a table. |
| `inputs.ts` | Nine input shapes including the adversarial ones, eight graph shapes, all seeded. |
| `catalogue.ts` | Per-algorithm metadata, one run door, comparison, and growth measurement. |

**The trace is the algorithm's own account of itself.** Nothing animates a plausible sequence: the bars are the
array replayed from the recorded swaps, the highlighted pair is the pair the algorithm compared, and the counts come
from the recorder. Stepping backwards is exact rather than an undo.

**It is measured, not asserted.** `n log n` appears nowhere in the counting code. The catalogue states the textbook
complexity and the engine reports what happened; `AlgorithmCompare` shows them side by side and labelled.

**Bounded.** Every run has a step ceiling (200,000). A run that reaches it reports `cut: true`, and its answer is
shown as incomplete rather than as the result.

**Deterministic.** No `Math.random` and no clock. Randomised quicksort takes a seed, so a comparison is a comparison.

### 2.2 Two Native Apps

| App | What it does |
|---|---|
| **Algorithm Laboratory** (`algorithm-lab`) | Runs any of the 24 algorithms step by step. Bars view, graph view, DP table view, full trace list, timeline scrubber, recursion tree, live call stack, measured counts beside stated complexity. |
| **Algorithm Comparison** (`algorithm-compare`) | Runs two to six algorithms over one identical seeded input and tabulates comparisons, swaps, writes and steps, with an optional measured growth table. |

Both are registered in the Phase 1 registry, found by Search Labs, and opened and configured by Orion.

### 2.3 Three fixes to the Phase 1 foundation

The brief says to repair the foundation rather than work around it. Three things were genuinely missing:

1. **Parameter definitions were not exposed.** `PublicInstance` carried values but not kinds, ranges or options, so
   no panel could render a control. `definitions` was added, and `Parameters.tsx` renders every Phase 2 app's
   controls from them — so every control goes through the runtime's validation rather than round it.
2. **Surfaces carried no live instance.** `SurfaceProps` gained `instance` and `onConfigure`, so an application can
   read its own parameters and set them through the checked path.
3. **A registered app could lack a surface.** `shared/native/surfaces.test.ts` now reads the renderer's surface map
   and fails if any registered app has nowhere to go — the dead-row failure the browser panel once had.

### 2.4 A worker, justified by measurement

The engine runs in `algorithms.worker.ts`, its own 84 KB lazily-loaded chunk. Not for appearance — the cost was
measured first:

| Work | Time |
|---|---|
| bubble sort, 1,000 values (hits ceiling) | ~200 ms |
| merge sort, 5,000 values | ~280 ms |
| seven-point growth curve | ~245 ms |

Any of those on the main thread is a visible stall while somebody is typing. Below that threshold a worker would be
complexity for its own sake, which §202 and §282 warn against.

The worker carries the generation it was asked under, and `useAlgorithms` drops any reply from a superseded one — the
same guard the Phase 1 runtime applies, in both places rather than trusted once.

---

## 3. Accessibility

Every algorithm state is readable without animation or colour:

- the current step is written in words above the stage, in an `aria-live` region;
- settled positions carry a tick as well as a colour;
- every step kind shows its name on a chip;
- the full trace is a list of buttons, each one navigable and clickable;
- play is a convenience — every state is reachable by stepping or by dragging the timeline;
- `prefers-reduced-motion` removes the bar transition and the laboratory still works.

---

## 4. Tests

| File | Tests |
|---|---|
| `shared/algorithms/algorithms.test.ts` | 71 |
| `shared/native/surfaces.test.ts` | 10 |

Beyond correctness-against-known-answers, these check the things that would otherwise be quiet lies:

- **The metadata's claims are claims.** `stable` is tested by replaying original positions through the trace's swaps —
  the obvious encoding trick (`value*100 + index`) makes every value distinct and so makes every sort look stable;
  that mistake was made here first and is documented in the test.
- **The trace agrees with the result.** Replaying the recorded swaps must produce the sorted array, or the display
  would be showing something the algorithm did not do.
- **The traced graph algorithms agree with `compute/discrete.ts`** on the same input, which is the only thing that
  makes keeping two implementations of Dijkstra defensible.
- **Refusals are features**: binary search on unsorted input, Dijkstra with a negative edge, counting sort on
  decimals, A* without positions, topological sort on an undirected graph.
- **The catalogue claims nothing Orbis lacks** — a test greps every summary, capability and tag for "python",
  "debugger", "profiler", "terminal" and fails if any appears.

Verified against the running application over CDP: 34 checks, all passing, including that Orion opens the laboratory
by capability with a list and target from a sentence, that a stale trace is dropped, and that chat, Pages, Courses,
the composer and Search Labs are unaffected.

---

## 5. Adding an algorithm

1. Write it in the right family file, taking a `Recorder` and emitting steps.
2. Add it to that file's `run*` switch.
3. Add an entry to `catalogue.ts` with its real complexity, stability and limits.
4. Add a case to `algorithms.test.ts` — the correctness loops pick up new ids automatically.

Nothing in the runtime, the worker, the registry or the UI changes. That is the property §48 asks for.

---

## 6. What was not built, and why

| Specified | Status |
|---|---|
| Code Laboratory: compiler, runner, terminal | **Not built.** No language runtime ships with Orbis and no process sandbox exists. §316 forbids advertising it. |
| Debugger: breakpoints, variables, call stack | **Not built.** No debugging protocol is reachable. §317 forbids fabricating variable values. |
| Profiler, code coverage | **Not built.** Nothing can measure them. §318 and §42 forbid fabricated figures. |
| Python, C, C++, Java | **Not built.** §316. |
| Compiler Explorer: IR, assembly | **Not built.** §39 forbids faking compiler stages. |
| Data Structure Laboratory | **Not built.** The engine does not exist yet; building it is a day's work and nothing was registered in the meantime. |
| Database Laboratory | **Not built.** Genuinely possible — `node:sqlite` is present — but needs a main-process service and a schema designer. |
| Graphing, Calculus, Linear Algebra, Statistics, Probability, Numerical Methods laboratories | **Not built as Phase 2 apps.** Their engines exist in `shared/compute` and the Phase 1 catalogue already registers 37 laboratories over them, including a function plotter, a statistics lab, a matrix lab and an optimiser. Phase 2 would give them parameter-driven apps; the parameter definitions were written and then removed rather than left registered without a surface. |

**Nothing from this list is registered.** The catalogue holds 40 apps, every one of which opens, and the surface
guard fails the build if that stops being true. A row that opens nothing is worse than no row.

### What an honest Code Laboratory would be

JavaScript and TypeScript only, executed in the Pages sandbox (`main/pages/host.ts`) — which is real, already built,
and genuinely locked down: `nodeIntegration` off, `contextIsolation` on, `sandbox` on, CSP travelling with every
response, navigation and `window.open` and permissions and downloads all refused. That gives real execution, real
`console` output, real errors with real stack traces, real cancellation by destroying the frame, and a real AST from
the TypeScript compiler, which is already a dependency.

It would have no debugger, no profiler, no terminal and no package installation, and its manifest would say so. The
manifest for exactly that app is written in the history of `shared/native/phase2.ts` and was removed with the rest
rather than shipped without its surface.
