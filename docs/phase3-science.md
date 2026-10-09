# Phase 3 — Science

Four scientific environments Orion can open inside a conversation, on top of the Native platform from
Phase 1. This says plainly what was built, what each one refuses to do, and what was deliberately not
built — because the brief's own rule (§205) is that a scientific tool which overstates itself is worse
than one that is missing.

## What was built

| Environment | Opens for | Computed by |
|---|---|---|
| Molecular Laboratory | "show me a water molecule", "what shape is methane", VSEPR | `shared/compute/molecules.ts` (new) |
| Field Laboratory | "show me the field around two charges" | `shared/compute/fields.ts` |
| Population Laboratory | "simulate predators and prey", logistic growth | `shared/compute/numerical.ts` (the ODE solvers) |
| DNA Laboratory | "translate this sequence", codons, mutations | `shared/compute/genetics.ts` |

Each is a Native App: a manifest in `src/shared/native/phase3.ts`, a parameter set, and a surface in
`src/renderer/src/components/native/`. They are found by Search Labs and opened by Orion through a
capability, exactly like the Phase 1 and Phase 2 apps — there is no second route.

## The one engine that was genuinely missing

Orbis already had about 22,000 lines of science: integration, invariant checking, parameter sweeps,
Monte Carlo, n-body, field grids, thermodynamics, genetics. Molecular structure was the only real gap,
so it is the only engine Phase 3 added.

`shared/compute/molecules.ts` builds molecules atom by atom and bond by bond:

- **Valence is checked against neutral counts only**, and formal charge shifts the range. So ammonium
  and hydronium work, and OH3 is refused — which is the point of checking at all.
- **A part-built molecule is `incomplete`, not `wrong`.** Only exceeding an element's maximum is wrong.
  Without that distinction the first O–H bond of water failed, and sulfur hexafluoride could not be
  built because it passes through three bonds on the way to six.
- **Shapes come from VSEPR**, and the angles shown are measured from the laid-out coordinates, not
  recited from a table. Methane comes out at 109.47°; water's 104.5° is the looked-up value because
  lone-pair repulsion is not modelled.
- **Polarity returns `null` when symmetry does not settle it**, rather than guessing. Carbon dioxide is
  correctly non-polar despite having two polar bonds.

48 tests assert chemistry that can be looked up independently.

## What each one says it does not do

Every manifest carries at least three stated limitations, and a test fails the build if one does not:

- **Molecules** — no quantum mechanics, no orbitals, no energies. Geometry is idealised VSEPR, so real
  bond angles differ. Resonance is not modelled.
- **Fields** — point sources only, static, no induced charge, no dielectrics, no radiation. Arrows are
  normalised for legibility, which the panel states, and points too close to a source are skipped and
  counted rather than drawn as infinities.
- **Populations** — a handful of classical models, not an ecology. The solver's own verdict (whether
  the step was small enough) is shown, because a plausible-looking curve from a diverging solver is the
  exact failure the brief forbids.
- **DNA** — the standard genetic code only. No promoter, no introns, no splicing, no regulation. A
  protein change is what the codon table gives; whether it matters to an organism is not modelled.

## What was deliberately not built

The brief listed 54 apps as a "minimum complete set". Four were built. The other fifty are not
registered, have no manifest and appear nowhere in the interface, because a row that opens nothing is
worse than no row — the lesson from the browser panel's eighteen dead rows.

Notably absent, and absent on purpose:

- **Fluid dynamics** and **n-body gravity** as apps. `nBody` exists as an engine, but no app surface
  does it justice yet, so `simulateFluid` and `simulateNBody` resolve to nothing. A test asserts that.
- **Quantum mechanics** of any kind.
- **Anything that would need a runtime Orbis does not ship.** No Python, no debugger, no profiler —
  `surfaces.test.ts` greps the whole catalogue for those words and fails if one appears.

## How this is kept honest

`src/shared/native/surfaces.test.ts` reads the renderer's surface map as text and asserts:

1. every registered app has somewhere to go;
2. every Phase 3 manifest is valid, names an engine, and states at least three limitations;
3. every declared parameter has a definition;
4. the capabilities Orion resolves through point at built apps, and the ones nothing provides resolve to
   `null`;
5. the catalogue claims no language or tool Orbis has not got.

## Verified against the running app

A CDP probe drove the real Electron window: 44 checks, all passing. It covered the four apps being
registered and openable, Search Labs finding each the way somebody would ask for it, Orion opening each
by capability, configuration from a sentence, the refusals (a molecule it has not got, a rotation beyond
a full turn, a grid beyond the cap, a timestep of zero, reading frame 0), progressive disclosure
(predator controls hidden for logistic growth, the replacement base hidden for a deletion), the stale
result being dropped, and regression of chat, Pages, Courses, the composer and Search Labs.

The probe is what caught the reading-frame convention: the genetics engine counts frames from 1 and the
parameter had been written 0–2.
