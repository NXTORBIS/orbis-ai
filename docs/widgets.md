# Widgets

The cards on the browser's start page: the time, the weather, what is due today, a price you follow. This is how
they work, for whoever maintains them.

## One system, not two

There used to be two. The Orbis window had a catalogue of nineteen widgets kept with the rest of what is personal,
edited in Customize, reachable by Orion — and **nothing drew them**; the screen that did was deleted. The browser's
start page had its own eleven, kept in that page's own storage, and they were the only widgets anybody could see.
Five of those did not work at all, because they asked Orbis through the browser's C++ pipe rather than through the
helper, and sat on "Loading…" for ever.

There is now one of everything:

| | Where |
|---|---|
| The catalogue — what a widget is, its sizes, settings, what it may read | `src/shared/widgets.ts` |
| The board and every change to it | `src/shared/widgetBoard.ts` |
| What a widget is shown, what it may ask to have done, and the samples | `src/shared/widgetFeed.ts` |
| Where the board is kept | the profile's personalisation file, through `ExperienceStore` |
| The one place it is changed | `src/main/widgets/runtime.ts` |
| What the widgets are shown | `src/main/widgets/data.ts` |
| How the start page asks | six helper channels (`src/helper/widgets.ts`) |
| What draws them | `orbis-ui/newtab/widgets/`, bundled into `widgets.js` |
| Orion's hands on them | `src/main/experience/widgetCapabilities.ts` |

A widget added by the gallery, by dragging, or by Orion is the same change, saved once, in one place.

## The board

A board is `{ enabled, instances, favourites, recent }`, read out of the personalisation file by `normalizeBoard`.
Every change is a `WidgetAction` through `applyWidgetAction`, which is pure: it gives back either a new board and a
sentence saying what happened, or a refusal with a reason. Nothing else edits the list.

The grid is 156px cells with 14px between, up to six columns (`GRID`, `columnsFor`). `packBoard` lays the instances
out in order, each in the first place it fits. The start page, the gallery's little picture of the start page, and
the outline shown while a card is being dragged are all `packBoard` — so they cannot disagree about where a card
will land.

Sizes: `small` 1×1, `medium` 2×1, `tall` 1×2, `large` 2×2, `wide` a whole row.

## The runtime, and why it reads back

`createWidgetRuntime({ store })` is the only thing that writes a board. Every request is applied by the reducer,
saved through `ExperienceStore`, and then **read back out of the store and compared with what was meant**. Only then
is it reported as done. The store normalises whatever it is given, so what comes back is what the start page will
really be drawn from — not what was asked for.

It also keeps, in memory and per profile:

- **undo and redo** — up to 50 boards back. Switching profile clears it, because taking back a change made to
  somebody else's page is not an undo.
- **layouts** — named snapshots of the board (the existing `dashboards` model). Using one puts its widgets on the
  page; changing the page afterwards changes the page, not the layout; saving under the same name brings the layout
  up to date. Deliberately a snapshot: two lists both claiming to be what is on screen is exactly how the start page
  and the rest of Orbis came to disagree in the first place.
- **what an open start page says it has drawn** — `report`, `rendered`, `waitForRender`. This is how Orion checks
  its own work, and it goes stale after fifteen seconds, because an old account says nothing about now.

`adopt` takes the board the start page used to keep in its own storage, once. Orbis records that it has done it
(`widgetsAdopted`), so a second tab cannot lay those widgets over whatever has happened since. The old storage is
left where it is; it costs nothing, and it is somebody's arrangement.

## What a widget may read

A widget never reads a store. It names one of thirteen **sources** (`WidgetSource`) and is handed a small, fixed
shape: titles and times, never whole notes; the last few things, never a history. There is deliberately no source
for passwords, cookies, the Secrets Vault, another profile or anything a site has, so there is nothing to hand over
by mistake.

Every answer says how true it is:

| | |
|---|---|
| `live` | read just now |
| `cached` | the last good answer, with the time it was **really** read and why there is no newer one |
| `offline` | there is no connection, and nothing kept |
| `unavailable` | anything else, with a reason in words; `needs` when the person has to choose something first |

A widget can also ask for one of eight **commands** (`WidgetCommand`) — tick a task off, copy a clip again, open a
workspace, ask Orion. Anything not on that list is refused at the door.

## The channels

The start page is a page in a different program from the one that keeps the widgets, so it asks over the helper:

```
widgets:get       []                   -> WidgetBoardState
widgets:act       [WidgetRequest]      -> WidgetReply
widgets:watch     []                   -> never answers; sends an event on every change
widgets:data      [WidgetFeedRequest]  -> WidgetFeed
widgets:do        [WidgetCommand]      -> WidgetCommandResult
widgets:rendered  [WidgetRendered]     -> true
```

Everything is checked before anything is read or changed: a request whose type Orbis does not have, a source that is
not a source, a command that is not a command. `widgets:watch` stops listening when the page goes away.

With Orbis not running the channels simply are not there, and the start page says *"Widgets need Orbis to be
running"* rather than drawing an empty board that looks like an answer.

## The page

`orbis-ui/newtab/widgets/`, TypeScript, bundled by `scripts/build-extension.mjs` into `widgets.js` — the name the
browser already serves, so no C++ changes. The CSS files in `widgets/css/` are joined onto `newtab.base.css` in a
fixed order and written out as `newtab.css`, for the same reason.

| File | What it is |
|---|---|
| `api.ts` | the contract every other file is written against |
| `link.ts` | the one connection to Orbis; keeps `widgets:watch` open and re-opens it quietly |
| `card.ts` | the card every widget is drawn in: its states, its failures, its timers |
| `renderers/` | one function per widget, by its id in the catalogue |
| `board.ts` | the grid under the search box, and arranging it |
| `gallery.ts`, `tile.ts`, `miniature.ts` | browsing and adding |
| `detail.ts`, `studio.ts`, `settingsForm.ts`, `sizePicker.ts` | one widget up close, and setting one up |
| `main.ts` | what `newtab.js` calls |
| `route.ts` | where the gallery is, written in the page's address |

**Trusted Types are enforced on these pages**: `innerHTML` and friends throw. Everything is built with `h()` and
`svg()` from `dom.ts`.

### Previews

A preview is the real card, with the real renderer, handed the sample from `WIDGET_SAMPLES` instead of the person's
own things. The renderer cannot tell the difference and must not care. That is why the gallery cannot drift from
what a person actually gets — and why a preview reads nothing of theirs to do it.

### Error isolation

A renderer runs inside a `try`, and so do its callbacks and timers. A widget that throws loses its own content, says
*"This widget stopped working"*, offers to try again, and takes nothing else with it. Three failures in a row and the
board sets it aside, where it waits under "Not on the page" while arranging.

### Where the gallery is

```
chrome://orbis-newtab/#widgets                  the gallery
chrome://orbis-newtab/#widgets?q=clock&in=time  searched and filtered
chrome://orbis-newtab/#widgets/weather          one widget from the catalogue
chrome://orbis-newtab/#widgets/on/<id>          one widget that is on the start page
```

In the address so Back closes it, a reload stays where it was, and Orion can open it by opening an address.

## Orion

`src/main/experience/widgetCapabilities.ts`, through the same runtime. List, look at one, add, remove, move, resize,
configure, change its look, reset, show or hide, lock or unlock, switch the whole area on or off, apply a ready-made
layout, take back the last change, open the gallery.

Each one that changes something **observes, decides, acts and verifies**: reads the state, applies one request, reads
it back, and — when a start page is open — waits for that page to report the new revision, answering `shownOnStartPage`
with `true`, `false`, or `"no start page is open"`. A widget can be named by its own id, by what it is, or by its
name; an ambiguous name is refused with the choices rather than guessed at.

The gallery is opened through `surface.open`, which is the one capability allowed to send a tab to a page the browser
itself owns. It takes `at` — a fragment, on the address the table already holds — so it can say "the gallery, at the
weather widget" and cannot say "somewhere else entirely".

## Adding a widget

1. An entry in `WIDGETS` (`src/shared/widgets.ts`): its sizes, its settings, what it reads, where what it shows comes
   from, whether it needs the internet, and an icon name that exists in `orbis-ui/panel/rail/icons.js`.
2. A renderer in `orbis-ui/newtab/widgets/renderers/<group>.ts`. A catalogue entry with no renderer is never offered.
3. If it shows something new: a source in `WidgetFeedMap`, a sample in `WIDGET_SAMPLES`, a reader in
   `src/main/widgets/data.ts`, and a dependency wired in `src/main/index.ts`.
4. Tests for whatever it works out, and its CSS in `widgets/css/renderers-<group>.css`.

## Building it into the browser

```
node scripts/build-orbis-ui.mjs                        tokens
node scripts/build-extension.mjs                       widgets.js and newtab.css
powershell scripts/sync-orbis-panel.ps1 -Src C:/chromium/src
autoninja -C out/Default chrome
```

Nothing here needs a C++ change: `widgets.js`, `newtab.css` and `widget-logic.js` are already in the browser's
resource list. `widget-logic.js` is kept as a short note saying where everything went, because a name in that list
that points at nothing is a page that fails to load.

## What is not here

- Widgets anywhere but the browser's start page. `WidgetSurface` has one value, and the Orbis window no longer draws
  any; Customize points at the gallery instead.
- Widgets from anybody but Orbis. There is no way to install one.
- A price history for the markets widget: Orbis Markets keeps no intraday series for the strip, so the card draws no
  line rather than a made-up one.
- Offline game scores, which the Orbis window holds and the start page cannot read yet. The widget is in the
  catalogue, marked unavailable, with that reason.
