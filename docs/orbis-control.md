# Making an Orbis screen controllable

Orbis can already open a module, change a setting and work a web page. Until now it stopped at the outside of Orbis's
own screens: it could open Chess World and not reach the panel inside it, open a simulation and not change a parameter
in it. Opening something is the first step of the job, not the job.

This is the contract for the rest of it. A screen says what can be read, what can be set and what can be done on it;
the control layer passes those questions on. **No part of Orbis holds a list of Orbis's screens.** A module becomes
controllable by describing itself, not by anybody editing the assistant.

Three files, and you will only need the first:

| What | Where |
| --- | --- |
| How a screen declares itself (`useSurface`) | `src/renderer/src/lib/surfaces/` |
| The protocol and the pure path resolving | `src/shared/surfaces.ts` |
| The six capabilities that ask the questions | `src/main/browserControl/surfaceCapabilities.ts` |

---

## 1. The words

A **surface** is any controllable thing in the Orbis window: a module, a page inside it, a subpage, a tool, a panel, a
dialog. Surfaces nest as deeply as the real interface does.

A surface has:

- **an id** — its own segment of a path: `notifications`, `engine-panel`. Letters, digits and dashes.
- **a parent** — the *path* of the surface it is inside, or `null` for a root.
- **controls** — the things on it that hold a value.
- **actions** — the things that can be done on it.
- **state** — what it reports about itself right now.
- **possible children** — what it could open that is not open yet, and how.

A **path** is those ids joined with `/`, and the last segment may be a surface, a control or an action:

```
settings/notifications/quietHours
chess/study/engine-panel/depth
```

## 2. Declaring a screen

```tsx
import { useSurface } from '../lib/surfaces'

useSurface({
  id: 'engine-panel',
  parent: 'chess/study',
  name: 'Engine panel',
  kind: 'panel',
  controls: {
    depth: {
      name: 'Search depth',
      spec: { type: 'integer', description: 'How many moves ahead to look.', min: 1, max: 40 },
      get: () => depth,
      set: (value) => setDepth(Number(value))
    }
  },
  actions: {
    stop: { name: 'Stop thinking', run: () => engine.stop(), verify: () => ({ done: !engine.running(), detail: 'The engine has stopped.' }) }
  },
  state: () => ({ activity: engine.running() ? 'running' : 'idle', detail: engine.line(), progress: engine.fraction() })
})
```

That is the whole of it. There is **no dependency list**: what the screen declared on its latest render is held in a
ref, so every getter and setter is the current one and a changing set of controls needs no bookkeeping. The
registration lasts from mount to unmount.

### The rules, and why each one exists

**A surface describes what is already there — it is never a second way of doing it.** Every `get` reads state the
screen already has; every `set` calls the handler the screen's own control already calls. A setter that does something
the screen's own button does not do is a second code path that will drift from the first.

**Unregistering on unmount is the point of the hook.** A control that is offered and no longer exists is the fault
this product has suffered most: a plan reads the tree, decides, and then sets something on a screen that closed while
it was thinking. The hook makes the worst case an honest "that is not on screen any more".

**Reuse `ParamSpec`.** A control's `spec` is the same `ParamSpec` a capability's parameters use
(`src/shared/browserControl.ts`): `type`, `description`, `enum`, `min`, `max`, `required`, `sensitive`. Writes are
checked against it with the same `validateParams` every capability's parameters go through, so the rules and the
wording of a refusal are the same everywhere. Do not invent a second vocabulary.

**Anything that can change is a function.** `get`, `writable`, `unavailable`, `state` and `visible` are all asked at
the moment somebody wants to know. `writable: isReady()` instead of `writable: isReady` runs on every draw before
anything has been checked, and if it throws there it takes **the whole screen** out of the register rather than one
control out of the answer. That mistake was made and fixed while this was written; the register now reports a screen
that could not describe itself (`broken` in the tree's answer) instead of quietly leaving it out, but write it the
lazy way.

**A value that could not be read is not a value.** If a getter throws, the control comes back
`readable: false, value: null, unreadableReason: "…"`. So a getter that cannot answer should **throw**, not return a
default: `if (!loaded) throw new Error('This page has not finished loading.')`. Returning `false` would report a
switch as off because a file was slow.

**Say why something cannot be set, in a sentence.** `writable: () => ready ? true : 'Quiet hours are off, so there
are no hours to set. Turn quietHours on first.'` A bare `false` is a dead end; a sentence tells the caller what would
fix it.

**Never invent a measurement.** Leave `progress` out when nothing measures it — `0` reads as "just started" about
something that may be nearly done. Same for `default`: leave it out when there is no default (a default of nothing is
`null`, with the key present).

**Declare what an action really does.** `effects` (`'read' | 'write' | 'delete' | 'communicate' | 'execute' |
'authenticate'`) and `confirmation` (`'none' | 'always' | 'when-consequential'`) are read before the action runs: an
action that declares `always`, or `delete`/`communicate`/`authenticate`, makes Orbis ask the person first. The
capability itself can only declare one kind of effect, so **this declaration is the only thing that raises the bar for
your action.**

**`verify` is what turns "done" into "confirmed".** Without it the answer is `status: 'attempted'` and says in words
that nothing could confirm it. With it, return a real reading — ask the application again rather than reading your own
screen's state, which may not have redrawn:

```ts
verify: async () => {
  const got = await window.api.notifications()
  const left = (got.items ?? []).filter((one) => !one.read).length
  return { done: left === 0, detail: left === 0 ? 'Nothing is unread now.' : `${left} are still unread.` }
}
```

**A parent declares a possible child only when opening it really registers that surface.** `possibleChildren` is how
a route is planned to something that does not exist yet:

```ts
possibleChildren: [{ id: 'engine-panel', name: 'Engine panel', reach: { kind: 'action', action: 'showEngine' } }]
```

`reach` is one of:

| `reach` | Means |
| --- | --- |
| `{ kind: 'always' }` | It is there as soon as its parent is. |
| `{ kind: 'control', control: 'section', value: 'notifications' }` | Set a control on the parent: a tab strip, a section list, a mode chooser. |
| `{ kind: 'action', action: 'showEngine', params?: {} }` | Do something on the parent: open a panel, start a tool. |
| `{ kind: 'manual', how: 'join one from the lobby first' }` | Only a person can get there. Nothing is tried; the sentence is reported. |

If you declare a child that opens and then registers nothing, a walk takes a real step and cannot tell "it did not
open" from "there is nothing there" — which sends somebody looking for a bug in the wrong place. Keep the list beside
the `useSurface` call in the child, and add to both in the same change (see `CONTROLLABLE_SECTIONS` in
`src/renderer/src/components/settingsSurfaces.ts`).

**A screen that does not appear inside the thing that opens it says where it does appear.** Every Orbis module is
like this. The window shell is the only thing that can show Markets — setting its "what is on screen" control — but
Markets registers itself at the top level as `markets`, not as something inside the shell. So the shell's way in says
so:

```ts
{ id: 'markets', name: 'Markets', kind: 'module', reach: { kind: 'control', control: 'screen', value: 'markets' }, opens: 'markets' }
```

`opens` is the path the screen really appears at, and the walk waits for it there. Without it the walk waited under
the shell for `window/markets`, where nothing ever arrives, and reported a step that had worked perfectly as a step
that did nothing — so `open the markets screener` could never get past its first segment while Markets was closed.
The list of modules the shell can show this way is `MODULE_SCREENS` in
`src/renderer/src/components/shellSurfaces.ts`, and it holds only the modules that really do declare a surface: one
that does not would be a route that opens something and then waits for a screen that never says anything.

**Mis-wiring any of this fails silently, so it is checked.** `checkSurfaceWiring` in `src/shared/surfaces.ts` reads
the whole tree and reports every disagreement inside Orbis's own declarations: a way in that names a control the
screen has not got, a value the control does not take, parameters the button would refuse, two screens claiming one
path, a screen whose parent is not there, and a button whose name a setting has already taken (the setting is what a
path of that name finds, so the button becomes unreachable rather than ambiguous). It runs on every `screen.tree`
and whatever it finds comes back in `wiring`, so a route nobody can take is a sentence in front of somebody instead
of a feature nobody can reach. `src/main/browserControl/surfaceWiring.test.ts` drives it over the real shell.

**Put the declaration in a plain function when you want it tested.** A declaration written inside a component can
only be checked by drawing that component, and there is no browser in the test suite. Written as a function of the
screen's own state and handlers — `settingsSurface(screen)`, `notificationsSurface(screen)` — the whole chain can be
driven without React. That is how the two worked examples are tested.

## 3. What the main process can now do

Six capabilities, in the domain `screens`, registered on the same registry as the other seventy-four — so the
switches in Settings → What Orion may do, the effect policy, the tab lock, the approval prompts, the retries, the undo
journal and the log all apply to them unchanged.

| Capability | Params | Answers |
| --- | --- | --- |
| `screen.tree` | `path?`, `depth?` | `{ surfaces, count, registered, broken?, note? }` — every surface, flat, each with its path and parent's, its controls (type, value, range, writable), its actions and its state. |
| `screen.state` | `path` | `{ path, name, state }` |
| `screen.read` | `path` | `{ path, name, on, type, value, readable, writable, values?, min?, max?, note? }` |
| `screen.write` | `path`, `value` | The outcome, with the value the control **actually** holds afterwards. |
| `screen.do` | `path`, `params?` | The outcome, with whatever the action gave back. |
| `screen.goTo` | `path` | `{ path, opened, alreadyThere }` — opens whatever has to be opened on the way. |

`screens` is a new `ControlDomain`, with its own row in Settings → What Orion may do. Switching it off stops Orion
using the declared controls; it never stops the person using them, and `ui` remains a separate switch for operating
the window by clicking at it.

There is also a state part named `screens` (in `control.snapshot()`), shallow on purpose: the roots and what is
directly inside them, so a sentence about what is on screen costs one cheap question.

### Reading the answer honestly

`SurfaceOutcome.status` is the thing to read:

| `status` | Means | How it comes back |
| --- | --- | --- |
| `completed` | The screen confirmed it afterwards. | `ok: true`, `verification.verified: true` |
| `attempted` | It was carried out and nothing could confirm it; `detail` says why. | A **write** is `ok: false` with code `verification-failed` — setting the same value twice is harmless, so a quiet no-op is caught rather than reported as done. An **action** is `ok: true` with `verification.verified: false`, because a retry is what a caller does with a failure and an action done twice is a message sent twice. |
| `refused` | The request was wrong and would be wrong again: unknown path, not a control, cannot be set, wrong type, out of range. | `ok: false`, code `invalid-params` |
| `failed` | The setter or the action threw. | `ok: false`, code `failed`, recoverable |

A write to a control that **already holds that value** does not run at all: it comes back `ok: true` with
`data: { unchanged: true }` and a verification that says "Quiet hours is already on." That is the registry's own
"nothing to do" answer, and the reading it rests on is the same reading a write would have been confirmed against.

Nothing is clamped. A number outside a control's range is refused **with the range** rather than quietly becoming the
nearest allowed value, because 400 silently becoming 40 is an automation told it got what it asked for.

### Paths are resolved forgivingly, and every forgiveness is reported

`resolveSurfacePath` (pure, in `src/shared/surfaces.ts`) matches each segment in order of how sure each way is, and
the first way that finds **exactly one** thing wins: the exact id, the id ignoring case and punctuation, the name on
screen, a declared keyword, the start of either, all the words in any order, then a substring. So `animation speed`
reaches `animationSpeedMultiplier` and `Waiting for you` reaches the category `attention`. `how` says which way it
matched.

A level left out is found further down when exactly one thing answers (`chess/study/depth` →
`chess/study/engine-panel/depth`), and the levels jumped over come back in `skipped`.

**Two things that answer equally well are never chosen between.** The answer is a miss with `why: 'ambiguous'` and
both names, because picking one is how an automation sets the wrong thing and reports success. A miss also says how
far it got (`reached`), what stopped it (`stuck`) and what was really there (`choices`), so the next attempt is a
correction rather than another guess.

### Getting somewhere is one step at a time

`planNextStep` works out the next step from what is open now and what each parent says it could open; `screen.goTo`
takes it, waits for the screen it asked for to turn up, reads the tree again, and asks again, up to eight steps. One
step at a time because a surface that does not exist yet cannot say what is inside it — Chess World has to be open
before it can say Study is one of its pages.

Two details worth knowing when you declare a `reach`:

- **"Are we there?" is asked forgivingly; the route is followed strictly.** `screen.goTo` first resolves the path the
  same way a read does, so something already open is found however it was named. The walk itself only follows what a
  parent says it can open — a step through a level nobody mentioned would be Orbis opening something on a guess.
- **Opening a page is three changes, not one**: the control changes, the window draws, then the page that was drawn
  registers itself. The walk waits up to 1.5s for the screen it asked for. If the same step comes up twice anyway it
  stops and says so — "Orbis asked settings to open Notifications, waited, and it did not appear. Either it does not
  open that way, or nothing on it has said what can be done there." That sentence is why you must not declare a
  possible child that registers nothing.

## 4. Worked examples

Two real screens, both registered properly:

- **`src/renderer/src/components/SettingsModal.tsx`** → surface `settings`. Controls `section` (an enum built from
  `SETTINGS_SECTIONS`) and `search`; action `close`; possible children for the sections whose panels register.
- **`src/renderer/src/components/NotificationSettings.tsx`** → surface `settings/notifications`. Controls
  `quietHours`, `quietFrom`, `quietUntil` (the last two only settable while quiet hours are on, with the sentence that
  says so) and one switch per notification kind, built from the same list the page draws. Actions `sendTest`
  (`communicate`), `markAllRead` and `clearAll` (`delete`, `confirmation: 'always'`).

- **`src/renderer/src/components/settingsSectionSurfaces.ts`** -> `settings/account`, `settings/orion` and
  `settings/browsing`: the three remaining sections whose contents are plain `Settings` keys. The names and the
  standing instructions are the draft in the box, and each setter writes the box *and* saves it, because that is both
  halves of what a person does. The models come from `MODELS` and the twelve worlds from `AVATARS`, so a new one is
  choosable with no edit there. `autoFallback` and `reasoningEffort` are stored and read but chosen by nothing on
  screen, so they are offered as readings that cannot be set, each with the sentence saying why.

  Two decisions in it are worth copying. A chooser holds **one kind of value**: the model and the world are set by
  their id, with the names on screen said in the description, because a write is confirmed by reading the control back
  and `set('Nebula')` followed by `get() === 'orchid'` is a write that worked reported as unconfirmed. And a string's
  limit is **not** `max`: `validateParams` only looks at `min`/`max` for numbers, so a forty-character name limit is
  said in the description and enforced in the setter.

  `src/main/browserControl/surfaceAdapters.test.ts` drives all three, and ends with the guard that keeps them honest
  as Settings grows: every key in `SETTINGS_SECTIONS[].settings` for a section that describes itself has to be a
  control Orbis can really reach, or be named as one that deliberately is not.

Both declarations are in `src/renderer/src/components/settingsSurfaces.ts`, and
`src/main/browserControl/surfaces.test.ts` drives them through the whole chain: it opens Settings, walks to the
Notifications page nobody mentioned, turns quiet hours on with the word `"on"`, then sets the hour that could not be
set a moment earlier.

### Studying and playing

- **`src/renderer/src/components/student/studentSurfaces.ts`** → `student` (the navigation, `startFocus` and
  `restDay`), `student/session` (registered by `FocusRunning`, so its life is the session's life: pause, break, one
  more minute, write a thought down, end — and no controls, because a session's policy is snapshotted when it starts)
  and `student/settings` (every preference with the type and range `patchPreferences` gives it; `safetyOverride` asks
  the person, because it is the one setting that changes what is blocked *now*).
- **`src/renderer/src/components/courses/coursesSurfaces.ts`** → `courses` (search, and `open` by the title on
  screen), `courses/course`, `courses/lesson` (the reading position is a real control; `ask` declares `communicate`
  because the material goes to a model) and `courses/lesson/quiz` (one control per question, with the type that
  question really is). The course and the lesson are both children of `courses` because the screens *replace* each
  other.
- **`src/renderer/src/components/arcadeSurfaces.ts`** → `settings/games` (live in the window), and `games`,
  `games/catalogue` and `games/current` for the arcade, which is mounted wherever the offline page is drawn.

`src/main/browserControl/learnSurfaces.test.ts` drives all three down to a parameter. Four faults it found are worth
knowing about, because every adapter can make them:

1. **A refusal that names the wrong problem.** Pausing an already-paused session answered "the session is not running,
   so there is nothing to pause". True, and about something else.
2. **A check that compares two different moments.** A hint read its own count *after* asking for one and added one,
   which only works where the setter is immediate. Read the number before, and check that it went up.
3. **A request reported as a result.** Opening a course returned `done: true` from `verify` although the course screen
   had not drawn yet. Anything that needs a redraw is `attempted`, with words that say "not yet" rather than "it did
   not work".
4. **A name that swallows an action on its own parent.** Surfaces are matched before actions, and a segment is matched
   against every *word* of a name. A screen called "The open course" answered to `open` and hid the `open` action on
   Courses; two controls called "… while playing" made `play` ambiguous. Do not put another thing's name inside a name.

### Laboratories, studios and simulations

- **`src/renderer/src/components/labs/algovizSurfaces.ts`** → `algorithm-visualizer` and the `animation` panel inside
  it, registered by both copies of the laboratory (the Toolkit's and the Computer Science Studio's). The algorithm,
  the input, the generator behind the random data, the thirteen speeds its own buttons offer, the step, and the run.
- **`src/renderer/src/components/native/labSurfaces.ts`** → one declaration for *every* laboratory, built from each
  app's own declared parameters, so "set the launch speed to 25 m/s" works and 25,000 is refused with the range the
  simulation declared. A laboratory that keeps its values in its own boxes reports them as readings that cannot be
  set, with the sentence saying why.
- **`src/renderer/src/components/labs/labsSurfaces.ts`** → `labs`, the catalogue: how many laboratories there are and
  in which subjects, the search, and `open`. It declares **no children**, because opening one puts a card in the
  conversation that registers a screen of its own at the top level — the `open` action says where that is
  (`projectile-lab/…`) rather than claiming a child that never appears underneath it. Three things in it are worth
  copying: a catalogue that has not arrived is unreadable rather than empty (`0` laboratories would be reporting an
  empty product because a read had not finished), opening one is confirmed by the card turning up in the
  conversation rather than by the request having been made, and a laboratory the registry says cannot open here is
  refused with the registry's own sentence before anything is opened.

`src/main/browserControl/labSurfaces.test.ts` drives all three, with the real algorithms and the real catalogue.

### A whole module: Chess World

`src/renderer/src/components/chess/chessSurfaces.ts` is the same pattern at the size of a real module: the surface
`chess`, the seventeen areas reached from its rail, and the panels inside them — the engine panel, the move list and
the notes inside Study, the run inside Puzzles. Three things in it are worth copying.

**Nothing is described twice.** The opponents come from `DIFFICULTIES`, the clocks from `TIME_CONTROLS`, the ladder
from `BLIND_LEVELS`, the run modes from `RUN_MODES`, and all thirty settings fields — their types, their ranges, their
defaults and whether each one's value reaches anything at all — from `FIELDS` in `shared/chess/settings.ts`. Five of
those thirty are kept and read by nothing yet, so they are offered as readings that cannot be set, with the sentence
saying what has to change first. A level added to Chess World is a level Orbis can play against with no edit here.

**Prefer a control to an action.** A write is confirmed by reading the control back; an action has nothing to read
unless the screen gives it something. So stepping through a game is the control `move`, and the four buttons that
also exist return the move number they started from and compare it with the one the register reads afterwards.

**Do not name a control with a word that is in a child surface's id or name.** A path's last segment is matched
against the surfaces inside a screen *before* the controls on it, and the loosest way it matches is "every word
somebody said is in it". So while the engine panel's id was `engine-panel`, `chess/study/panel` found that panel
instead of the Study screen's `panel` control — and a write to it set the control, opened the panel, then read the
*panel* back and reported a write that had worked as unconfirmed, after waiting a second and a half for a reading
that could never come. The panel is `engine` now. Two related faults to watch for when you name things:

- An action called "Open a game to study" made `chess/study` resolve to that action, so a walk reported that it had
  arrived somewhere without opening anything. It is called "Open one of your games" now.
- `writeSurfaceControl` reads a control back by re-resolving the path it was given, so anything that changes what
  that path resolves to turns a write that worked into `attempted`. Reading it back by the surface's path and the
  control's id would make that impossible; until then, naming is what keeps it from happening.

`src/main/browserControl/chessSurfaces.test.ts` drives all of it: the rail mounts one area at a time, as React does,
so a walk to the engine panel really has to open the area first and the panel second.

### Music, and why it has no surface

Orbis Music is controllable down to the parameter, and **not through a surface**. It is worth knowing why, because the
obvious thing to do here is wrong.

A surface describes a screen in the Orbis window. Music has no screen there. Its one screen is in the browser's own
panel (`orbis-ui/panel/panel-music.js`, served from the Chromium tree), which is a different document in a different
program; it reaches Orbis over the helper, and the register the six `screen.*` capabilities ask lives in the Orbis
window's renderer. So a `music` surface registered in the window would describe nothing that is on screen, and every
`set` on it would be a second code path beside the one the panel's own controls use — the one thing the protocol
above forbids.

What Music has instead is its own domain, `music`, and twenty-five capabilities in
`src/main/browserControl/musicCapabilities.ts`. They reach the same depth a surface would, and they keep the same
rules:

- **The parameters come from the module's own models.** The preferences, their types, their ranges and their allowed
  values are built from `DEFAULT_MUSIC_SETTINGS` and `MUSIC_SETTING_VALUES` in `src/main/music/store.ts`; the
  listening modes are the keys of the ranker's own `MODE_SHAPE` and the discovery levels its own `DISCOVERY_LEVELS`.
  A preference added to the store is one Orion can read and set with no edit here.
- **There is one door.** Everything that changes anything goes through `handle.ask`, the single operation runner the
  window and the panel both use. `MUSIC_SETTING_VALUES` exists because that list was written out twice: a value added
  to one copy would have been accepted off the disk and refused to the person.
- **Nothing is clamped and nothing is guessed.** A volume of 4 is refused with the range, a switch set to "maybe" is
  refused with the two words it takes, a queue position that is not there is refused with the real length, and a
  preference that cannot be set from here (the watched folders, which need a person at a file picker) comes back as a
  reading with the sentence saying so.
- **Every change is checked against a reading taken afterwards**, asked of the store or the player rather than of
  what the save handed back. A preference change is in the undo journal, reversed through the same capability.

One habit of the music service is worth knowing when adding to this: **it does not check what it is given.** An
unrecognised repeat mode quietly becomes `off`, an unrecognised listening mode is handed to the ranker anyway, and a
queue position it cannot use is ignored with nothing said. So the refusal has to happen in the capability — as a
declared `ParamSpec` enum where the values are a fixed list, which refuses before `run` with the whole list in the
wording, and in `run` where the check needs real state (the queue's length).

## 5. The wire

There is **no new IPC channel**. The six questions go over `control:window-run`, the channel the address bar's
capabilities have always been carried out on, so there is one door between the application and its window with one
sender check on it. Their names (`SURFACE_CALLS` in `src/shared/surfaces.ts`) are deliberately not the capability ids:

| Question | Answered by |
| --- | --- |
| `surface.tree`, `surface.state`, `surface.read`, `surface.write`, `surface.run`, `surface.lookup` | `answerSurfaceCall` in `src/renderer/src/lib/surfaces/answer.ts` |

`WindowControl.ask()` is the main process's end. If you are adding a capability that reaches into a screen, add it in
`surfaceCapabilities.ts` and ask one of the existing questions; do not add a channel.

## 6. Checklist for an adapter

1. `useSurface({ id, parent, name, kind, controls, actions, state })` in the screen, above any early return.
2. Every `get` reads live state; every `set` calls the handler the screen's own control calls.
3. `spec` is a `ParamSpec` with the real range and the real list of values.
4. `writable` is a function returning `true` or a sentence.
5. A getter that cannot answer throws.
6. `effects` and `confirmation` declared on anything that does more than change what is on screen.
7. `verify` on every action that can be checked, asking the application rather than the screen.
8. `possibleChildren` on the parent, for children that register when opened — in the same change as the child.
9. If the declaration is worth testing, make it a plain function of the screen's state and test it against the
   register.
