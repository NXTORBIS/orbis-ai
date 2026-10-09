# The Orbis Native Interactive Platform

How an interactive app gets into a conversation, and how to add one.

This describes what is implemented. Where something is deliberately not built yet, it says so rather than
describing a plan as though it were code.

---

## 1. What it is, in one paragraph

Orion can answer a question, or it can open a real interactive app inside the conversation — a plotter, a
laboratory, a simulation. The Native Platform is the layer that makes the second possible: it holds a register of
what exists, resolves "the user wants to see a projectile fly" to an app, keeps each opened copy separate,
validates every value that reaches one, and mounts it in the chat as a card beside the reply.

It holds no domain logic at all. There is no branch anywhere in it that knows what gravity is.

---

## 2. What it is not

It is **not** a second Pages registry. `src/shared/pages/` already owns Page identity, permissions, sandboxing and
versioning, and `src/shared/compute/` owns roughly a hundred real computational engines. Neither is replaced.

An app id **is** its Page slug, deliberately, so the two layers cannot disagree about which app somebody's saved
state belongs to. Where the two could conflict — a Page's identity, its permissions, whether it may run — the Pages
registry is right and this layer is stale.

It is also not a second discovery index. Search Labs and Orion call the same function, `Native.find`. Two lists
would eventually produce a search result nothing can open, which is exactly the failure the browser panel had.

---

## 3. The shape

```
message in the chat
      |
      v
intent.ts            is this a request to open something?   (pure; a model decides, a reader checks)
      |
      v
registry.ts          which app provides that capability?    (pure; returns null rather than guessing)
      |
      v
parameters.ts        are these values allowed?              (pure; units, dimensions, ranges)
      |
      v
instances.ts         one opened copy, with its own state    (pure; generations guard late results)
      |
      v
service.ts           the runtime                            (main process; owns registry + instances)
      |
      v
NativeAppCard.tsx    a card in the conversation             (renderer; mounts the app's own screen)
```

Everything above `service.ts` is pure, has no clock and no storage, and is unit-tested. `ipc.ts` is the only file
in the layer that imports Electron, which is why `main/native` sits on the no-Electron list in
`portability.test.ts`.

---

## 4. The files

### Pure (`src/shared/native/`)

| File | What it owns |
|---|---|
| `manifest.ts` | What an app declares: identity, capabilities, sizes, actions, permissions, limitations. Validation refuses, never repairs. |
| `registry.ts` | The register, the capability index, `launchable`, `discover` (the one ranking function), `resolve`, `dataFlows`. |
| `parameters.ts` | Typed parameters with units. Coercion, validation, `set`/`setAll`/`reset`, visibility, derived-value invalidation. |
| `instances.ts` | One opened copy. Lifecycle, phase transitions, the **generation counter**, isolation, sweeping. |
| `actions.ts` | What Orion may ask. `readAction` (shape), `plan` (existence, declaration, permission), the result contract. |
| `state.ts` | Saving and reading back. Two version numbers, migration, restore with what-could-not-be-restored reported. |
| `chat.ts` | How an app belongs to a conversation: the reference, `cardState`, `reuseOrOpen`, `mounted`. |
| `intent.ts` | Whether a message wants an app. Cheap pre-check, the prompt, the strict reader. |
| `catalogue.ts` | The 38 apps Orbis actually has, and the parameter sets for the four that are wired. |

### Main process (`src/main/native/`)

| File | What it owns |
|---|---|
| `store.ts` | Per-profile persistence: `instances.json`, `recent.json`, `disabled.json`, built on `JsonFile`/`Collection`. |
| `service.ts` | The runtime. Registry + instances + dispatch. The only thing the IPC layer talks to. |
| `orion.ts` | The model call, and carrying out what it decided. |
| `ipc.ts` | One channel, `native:do`. Coerces and delegates; decides nothing. |

### Renderer (`src/renderer/src/components/native/`)

| File | What it owns |
|---|---|
| `SearchLabs.tsx` | The composer popover. Searches, ranks, opens. Keyboard-navigable. |
| `NativeAppCard.tsx` | The card in a conversation. Header, size, lifecycle buttons, visibility reporting. |
| `surfaces.tsx` | App id → React component, all lazily loaded. |
| `icons.ts` | Manifest icon names → lucide components. |
| `native.css` | The `na-` namespace. Host only; nothing in here styles an app's interior. |

---

## 5. The five rules that matter most

### 5.1 A late result is dropped

Every instance has a `generation`. Anything that invalidates work in flight — a reset, a reconfigure, a close —
increments it. An asynchronous call records the generation it started under and hands it back, and `accepts`
rejects a mismatch.

```
open -> start a 3-second computation -> reset -> the old result arrives
```

Without the guard, that sequence writes a number computed from the old configuration into the new one, and the
display is then wrong in a way nothing reports. This is the worst bug this platform can have, and it is tested
both as a unit and against the running app.

### 5.2 Two instances are genuinely independent

Every function in `instances.ts` returns a new instance rather than editing one. Changing gravity in one open
simulation cannot touch another, so comparing two configurations compares something.

### 5.3 Units are checked, not assumed

Parameters go through `shared/compute/units.ts`, which already parses and dimension-checks units for the whole of
Orbis. `"36 km/h"` into a parameter declared in m/s becomes `10`. `"5 kg"` into gravity is refused with a sentence
saying kilograms measure something else. A silent unit mismatch is what makes a simulation confidently wrong.

Out of range is **refused, not clamped**. Somebody asking for a 400° launch angle has misunderstood something, and
quietly using 360 hides that from them.

### 5.4 Unreadable is not missing

`state.read` has three outcomes, not two: `ok`, `absent` (nothing saved — normal), and `damaged` (something is
there and cannot be read). Nothing converts the third into the second. The underlying `JsonFile` refuses to write
over a file it could not read, and `storedFile.ts` quarantines an unparseable one as
`<name>.unreadable-<timestamp>` rather than deleting it.

### 5.5 Nothing claims success it did not have

`save` says saved only after the store wrote it. A refused action comes back as a refusal with the reason. Orion
repeats these sentences to the user, so a cheerful fiction here becomes a lie on screen.

---

## 6. Adding a Native App

### 6.1 An app whose screen already exists

1. Add a manifest to `CATALOGUE` in `shared/native/catalogue.ts`.
2. Add `id -> component` to `SURFACES` in `renderer/src/components/native/surfaces.tsx`, lazily.
3. If its icon is new, add it to `icons.ts`.

That is all. `native.test.ts` validates every manifest, refuses duplicate ids and duplicate surfaces, and checks
that every declared parameter has a definition.

### 6.2 Making an app configurable from a sentence

Two things, in this order:

1. Declare its parameters in `catalogue.ts` — **with the real field names its component uses**. A parameter that
   does not correspond to a field is a parameter nothing can apply.
2. Have the component read them. Every lab keeps its inputs as text in its own state, so this is a default rather
   than a rewrite:

```tsx
const [speed, setSpeed] = useState(() => initial?.speed ?? '40')
```

Four apps are wired this way: `projectile-lab`, `motion-lab`, `function-plotter`, `statistics-lab`. The rest
declare no parameters and say so in `limitations` — Orion can open them and cannot set their values. That is
stated rather than discovered.

### 6.3 An app with an engine and a renderer of its own (Phase 2 onwards)

- `surface: { kind: 'native', ref: 'YourComponent' }`
- Declare `engine`, and have the main process report it in `readiness().engines`, or the app is correctly reported
  as unavailable rather than opening and failing.
- Declare actions it supports. An action an app did not declare cannot be invoked, however reasonable the request.
- Compute off the main thread and report results through `native('result', instanceId, generation, state)`, so the
  generation guard applies.

---

## 7. What Orion may do

Thirteen action kinds, in `actions.ts`: `open`, `configure`, `invoke`, `run`, `pause`, `reset`, `resize`, `close`,
`state`, `save`, `load`, `export`, `find`. Everything domain-specific is an app's own declared action, reached
through `invoke`.

Four gates before anything runs:

1. **Shape** — `readAction`, field by field. An unknown kind is refused, not approximated.
2. **Existence** — the app is registered; the instance is open.
3. **Declaration** — the app declared this action.
4. **Permission** — it may do what the action needs; it can open on this machine.

Orion is shown only ids, names, capability ids and one-line summaries — not manifests, not parameters, not state. A
model given five thousand tokens of catalogue spends its attention there instead of on the question.

`export` is declared by four apps and carried out by the app's own export button; the runtime has no file writer of
its own, and inventing one would put a second file path beside the Creation Engine's.

---

## 8. How an app belongs to a conversation

A message carries `{ appId, instanceId, act, appVersion, did, openedAt }` — a pointer, exactly like
`ChatArtifact`. The card reads the live instance when drawn, so:

- a conversation does not get slower as apps accumulate in it;
- an app shows what it holds **now**, not what it held when the reply was written;
- a closed app says so, and an app no longer in the build says *retired*, which is a different thing from *gone*.

`MOST_MOUNTED` is 6. Beyond that the oldest become cards that mount on demand — except anything **running**, which
stays mounted however far it has scrolled, because unmounting a running computation to save a frame loses a result
somebody was waiting for.

The card reports its own visibility through an `IntersectionObserver`, which is what makes `whenHidden` real: an
app that asked to pause when hidden actually pauses.

---

## 9. Persistence and profiles

Everything is per-profile, under `<userData>/<profile>/native/`. `useProfile` flushes what is pending to the file
it belongs to *before* moving, so a value changed a moment before a profile switch lands in the profile it was
changed in. Open instances are not carried across — they belonged to the profile that was active.

Only an app with `persists: true` is saved. The closed card's wording depends on it: an app that keeps nothing says
"opening it again starts it fresh" rather than promising to restore what it never had.

Restored instances come back `loading` and off screen, **never running**. Resuming an expensive computation nobody
asked to resume costs somebody a core at launch.

---

## 10. Tests

| File | Covers |
|---|---|
| `shared/native/native.test.ts` | 115 tests: manifests, parameters and units, registry and ranking, instances and generations, actions, state and migration, chat cards, the whole catalogue, intent. |
| `main/native/native.main.test.ts` | 8 tests against real files: restart restoration, profile isolation, a save queued across a profile switch, quarantine of a damaged file, an app that cannot run here. |

Both are listed in `scripts/testFiles.mjs`. The structural guards — `testSuite`, `ipcMapping`, `portability`,
`cssCollisions`, `orbisUiSyntax`, `accessibleUi` — all cover this layer and all pass.

Three things only a running app can show, and they were verified over CDP against the real window: that the
channel is registered and the catalogue reaches the renderer, that a value given in another unit is converted by
the real engine path, and that a late result is actually dropped. Two faults were found that way and fixed — the
Search Labs popover overflowing the window on an ordinary window height, and the closed card promising to restore
state for an app that keeps none.

---

## 11. What is deliberately not here

- **No Phase 2–5 apps.** No compiler, no debugger, no terminal, no algorithm visualiser, no chemistry or biology
  engine. Registering one now would make it findable in Search Labs and then fail, which is worse than its absence.
- **No fake engines.** No engine that returns "simulation complete" or animates predetermined values.
- **No generic simulation app** with a canvas and sliders that every subject is made to fit.
- **No GPU, process, network, camera or microphone permissions.** Nothing in this phase has them, and listing one in
  `readiness()` would make an app launchable that cannot work.
- **Deterministic replay, checkpoints and experiment branching** exist as contracts in `shared/pages/experiments.ts`
  and are not yet driven from this layer.
