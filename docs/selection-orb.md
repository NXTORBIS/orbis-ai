# The selection orb

Select some words on any web page and a small Orbis orb appears at the end of them. Click it and the things worth
doing with that text appear — explaining it, looking it up, keeping it, opening it. Every one of them runs a real part
of Orbis.

## What it looks like

```
…cannot be described independently of the others. ●
                                                  ┌──────────────────────┐
                                                  │ Ask anything…        │
                                                  │ ▸ Explain            │
                                                  │ ▸ Summarise          │
                                                  │ ▸ Search             │
                                                  │ ──────────────────── │
                                                  │ ▸ More             › │
                                                  └──────────────────────┘
```

Nothing appears while the mouse is still down, nothing appears for a stray click, and the whole thing is gone the
moment the selection is.

## The four files, and why they are four

| | Where | What it may do |
|---|---|---|
| What the text **is** | `src/shared/selectionText.ts` | pure; no network, no model, no DOM |
| Which actions that **earns** | `src/shared/selectionActions.ts` | pure |
| Where things **go** | `src/shared/selectionPlacement.ts` | pure arithmetic on rectangles |
| What Orion is **asked** | `src/shared/selectionPrompts.ts` | pure |
| The orb and the palette | `extension-src/selection/main.ts` | draws; decides nothing; reaches nothing |
| What actions actually **do** | `extension-src/selection/worker.ts` | the only side that can reach Orbis |

The split between the last two is the security model, not a tidiness preference. The page side runs in the extension's
isolated world and holds no address and no secret; it can only send a message. The worker side decides for itself
whether to honour it.

The first four are pure so they can be tested without a browser — `selectionText.test.ts` and
`selectionPlacement.test.ts`, 48 tests covering what counts as code, what counts as a secret, where a panel goes when
the selection is at the bottom of the window, and so on.

## What it will not do

**The page cannot touch any of it.** Everything is in a *closed* shadow root. A page can neither read what was
selected through Orbis, nor style the orb, nor cover it with an invisible layer and take the clicks, nor call anything
from its own scripts.

**Nothing sensitive leaves.** The selected text is read twice — once in the page to decide what to offer, and again in
the worker before anything is sent. A selection that looks like a key, a token, a card number (checked by its
checksum, not its shape) or anything in a password box loses every action that would send it anywhere, and the palette
says why. Copying it is still allowed; that is between you and your clipboard.

**The selection is copied before anything else happens.** Clicking the orb moves the focus, and the browser may drop
the native selection when it does. Every action is given the copy taken when the orb appeared, so what runs is always
what was selected and never what happens to be selected now — including when a long answer is still arriving and you
have clicked elsewhere.

**Nothing is offered that cannot run.** Each action names what it needs; the worker asks Orbis what is really there
and an action whose need is missing is not drawn greyed out, it is not drawn at all. With Orbis closed the palette
says so rather than showing buttons that fail.

## Where each action goes

| Action | Runs |
|---|---|
| Ask · Explain · Define · Summarise · Fact check · Simplify · Rewrite · Translate · Explain code · Find the bug · Solve · Analyse | `orion:ask` — the same Orion the chat uses, with the same Auto Mode choosing the model |
| Search | `browser:do` → `surface.open` → Orbis Search (`chrome://orbis-search`) |
| Open | `browser:do` → a real Chromium tab |
| Copy | the page's own clipboard |
| Save to Notes | `notes:create` — the real Notes, with the page it came from |
| Send to Whiteboard | `whiteboard:add-text` — the real Whiteboard, with the page it came from |

Each is given the least it needs. Explaining a sentence is given the sentence. Checking a claim is also given the
page's address, because a claim about "the company" means nothing without knowing whose page it was on. Nothing is
given the whole page.

## How the worker reaches Orbis

The built-in pages (`chrome://orbis*`) get the helper's port and the run's secret from the browser itself. An
extension cannot ask for that, so the app hands it over when it starts the browser, down the debugging pipe it already
holds, into `chrome.storage.session` — which lives in memory, is cleared when the browser closes, and cannot be read
by any page or any other extension. See `browserManager.ts`.

## Checking it

`scratchpad/selcheck.mts` drives the real browser on a real page: it starts a helper with stand-ins for Orion, Notes
and the Whiteboard, hands the extension their address, then selects each kind of text and reads back both what the
palette offered and what reached each service. The stand-ins are the harness's — the product calls the same channels
it would in anger, which is how "Explain was pressed" is told apart from "Explain sent Orion the right question".

Two traps in checking it:

- The orb is in a **closed** shadow root, so a probe cannot read it from page script either. It is read through CDP's
  `DOM.describeNode` with `pierce`, which is what devtools does.
- A service worker that has only just started **has no `chrome` object yet**. Hand it anything before that and the
  write goes nowhere, and the orb then correctly reports that Orbis is not running. The app's own bridge waits; a
  probe must too.
