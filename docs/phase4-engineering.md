# Phase 4 — Engineering

Four engineering laboratories Orion can open inside a conversation, plus the three things that were specified in
Phase 2 and deliberately left out of it. This says plainly what was built, what each one refuses to do, and what the
Phase 4 brief asked for that does **not** exist — because a registered app with nothing behind it is the failure this
whole platform is built to prevent.

## What was built

### The three that Phase 2 left out

| Laboratory | Opens for | Computed by |
|---|---|---|
| Data Structures | "show me a binary search tree", "how does a hash table work" | `shared/structures/` (new, 53 tests) |
| Database | "practise SQL", "what does a query plan mean" | SQLite, in memory, via `main/native/sql.ts` (new, 34 tests) |

Eleven **mathematics laboratories** also became configurable from a sentence — unit converter, equation solver,
calculus, algebra, matrix, geometry, number, uncertainty, signal, curve fitter and coordinate. They already existed;
what they lacked was declared parameters, so Orion could open them but not set anything up. 23 apps and 98 controls
are now configurable, up from 4 apps and 20.

### Phase 4 proper

| Laboratory | Opens for | Computed by |
|---|---|---|
| Circuit | "build an RC circuit", "what is a time constant", resonance | `shared/compute/circuits.ts` |
| Control | "simulate a PID controller", "show me a Bode plot", tuning | `shared/compute/controls.ts` |
| Robot Arm | "build a robot arm", "move the gripper to this point" | `shared/compute/robotics.ts` |
| Structures | "analyse this beam", "which members of a truss are in tension" | `shared/compute/beams.ts` + `statics.ts` |

**None of these four added any engineering to Orbis.** Every engine behind them already existed and was already
tested: a nodal-analysis circuit solver, a control engine with pole-zero analysis, Bode plots, Routh-Hurwitz and five
tuning rules, a robotics engine with Denavit-Hartenberg kinematics and damped-least-squares inverse kinematics, and
beam and truss solvers. The gap was that none of it could be reached from a conversation. That is what Phase 4 fixed.

## Two new engines, and nothing more

Phase 4 wrote exactly two:

**`shared/structures/`** — twelve data structures, each recording every comparison, pointer change, bucket tried and
rotation as it works. The counts are measured, never stated, which is what lets the laboratory show that a search
tree given sorted keys costs 64 comparisons where a balanced one costs 7.

The honesty rules that shaped it:

- **A plain binary search tree is not quietly balanced.** Given sorted keys it degenerates into a list, the height is
  shown, and the panel says how much taller it is than it needs to be. That is the whole reason AVL trees exist.
- **A hash table's collisions are real collisions.** The bucket comes from an actual FNV-1a hash, so two keys share a
  bucket because they genuinely hash the same way at that table size.
- **Open addressing leaves tombstones.** Blanking a removed slot would cut the probe chain and hide every key that
  had to step past it. There is a test for exactly that, and it is the most important test in the file.
- **A deque backed by an array counts the shifting.** Working at the front moves everything, and the counts show it
  rather than pretending both ends are free.

**`main/native/sql.ts`** — real SQLite, one in-memory database per open laboratory.

- **Nothing is written to disk**, nothing survives closing Orbis, and no laboratory can see another's tables.
- **Typed SQL is checked before it reaches the engine.** `:memory:` alone is not enough: `ATTACH DATABASE` would let a
  query open, read and write a file. So statements that can leave memory are refused by name with a reason. The guard
  blanks comments and string literals first, so a column called `attachment` still works and a forbidden statement
  hidden behind a comment is still caught.
- **The query plan is the engine's own.** Adding an index changes the plan in front of you, which is a thing no
  explanation can do.
- **The practice data says it is practice data.** It is shaped like real data so joins have something to join, and
  every dataset carries a line saying nothing in it is a measurement of anything.

## What each one says it does not do

Every manifest carries at least three stated limitations, and a test fails the build if one does not. Among them:

- **Circuit** — ideal components, no parasitics, no semiconductors at all. There is no diode, transistor or
  operational amplifier, because Orbis has no model for one. You cannot draw an arbitrary circuit.
- **Control** — one loop, one controller, a linear plant. No cascaded loops, no feedforward, no gain scheduling. A
  tuning rule is shown and never applied, because the point is to see what it would change.
- **Robot Arm** — weightless links, no collision checking whatsoever, position only and not orientation, and a flat
  arm. Reaching is iterative, so there is always a small error left.
- **Structures** — small deflections and a material that springs back. No finite-element analysis, no plates, no
  shells, no three-dimensional frames, no dynamics. A truss with spare members is reported as unsolvable by this
  method rather than guessed at.
- **Data Structures** — 4,000 keys, the twelve structures it ships with, operation counts rather than timings.
- **Database** — made-up data, in memory only, file-opening statements refused, five-second and 2,000-row caps.

## What the Phase 4 brief asked for that does not exist

The brief listed eighteen subject areas. Four laboratories were built. The rest are **not registered, have no
manifest, and appear nowhere** in the interface:

- **Digital logic** — no gates, adders, flip-flops, counters or state machines. No engine.
- **Instruments** — no oscilloscope, signal generator, multimeter, logic analyser or spectrum analyser as such. The
  circuit laboratory plots voltage and current over time, which is what an oscilloscope shows, but it is not one.
- **Microcontroller** — nothing. Orbis runs no code on the host and ships no emulator.
- **Breadboard, schematic capture** — nothing. There is no circuit editor.
- **Machine learning and neural networks** — nothing. No models, no training, no metrics.
- **Computer vision and image processing** — nothing. No convolution, no filters, no segmentation.
- **Networking** — nothing. No topology, packets, TCP, DNS, DHCP, NAT, firewall or subnetting.
- **Operating systems** — nothing. No scheduling, paging, synchronisation or deadlock simulation.
- **Computer architecture** — nothing. No registers, ALU, pipeline, cache or instruction execution.
- **CAD** — nothing. No sketches, constraints, extrusion or solids.
- **Finite-element analysis** — nothing beyond the beam and truss solvers, which are closed-form rather than FEM.
- **Mechanisms** — no four-bar linkages, gears, cams or pulleys as an application, though `rigidBody.ts` exists.

A test asserts that `simulateLogicGate`, `trainNeuralNetwork`, `simulateNetwork`, `simulateCpu`, `processImage` and
`runFiniteElement` all resolve to **nothing**, and greps the whole catalogue for words Orbis cannot deliver on.

## Three defects the runtime probes found

None of these could be caught by a unit test, and all three were pre-existing:

1. **`visible()` required every condition to hold.** Two conditions on the same parameter meant the control could
   *never* appear — a control declared, drawn in no state, and silently doing nothing. Conditions on one parameter are
   now alternatives; conditions on different parameters must still all hold.
2. **A tag of several words could never match.** `terms.includes('hash table')` is always false because terms are
   single words, so every multi-word tag in the catalogue was dead weight that looked like coverage. Searching "hash
   table" found the Data Explorer.
3. **A refused choice never named the control.** Every other refusal in `parameters.ts` names the parameter; the
   choice case did not. A batch of thirteen values refused for one bad choice read as `"unobtainium" is not one of the
   choices` with nothing saying which control that was.

## Verified against the running app

Three CDP probes drove the real Electron window:

| Probe | Checks | Covers |
|---|---|---|
| Data Structures + Database | 56 | registration, search, Orion by capability, configuration, the SQL guard across the real IPC boundary |
| Mathematics | 26 | every one of the eleven labs taking every one of its declared values |
| Phase 4 engineering | 70 | registration, search, nine capabilities Orbis must *not* claim, configuration, progressive disclosure per circuit kind, refusals, the generation guard |

All passing, plus ten structural guard suites and 87 engine tests.

The probes are what caught all three defects above, and one trap worth recording: **instances persist**, so a probe
that relies on a parameter's default value reads whatever the previous run left. The platform restoring state is
correct; the probe has to set what it asserts.
