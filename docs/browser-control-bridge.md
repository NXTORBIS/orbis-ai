# How Orbis controls the browser

Orbis's Browser Control Layer — a hundred capabilities for driving a browser — was written for the Electron build and
has always been free of Electron. When Orbis became its own Chromium, the layer survived the move intact and lost the
only thing it could not do without: a connection. The helper ran beside a browser it had no way to reach, so every
request to act on the browser failed with *"The browser is not ready."*

This is that connection.

## The shape of it

```
Orb / panel  ──HTTP──▶  helper  ──pipe──▶  Chromium
  (a page)               (node)             (the browser)
```

The helper **starts the browser**. That is the whole trick. Chromium is launched with `--remote-debugging-pipe`, which
hands the DevTools protocol to the process that started it over file descriptors 3 and 4 — and to nobody else.

The alternative, a debugging port, would have been one line shorter and would have opened the browser to every other
program on the computer, and to any page the browser ever loaded. Nothing listens on the network for this.

| Piece | Where | What it does |
| --- | --- | --- |
| `src/helper/browser/host.ts` | helper | Starts Chromium, holds the pipe, exposes the control layer |
| `src/helper/browser/tasks.ts` | helper | `browser:task`, and the approval gate |
| `src/helper/browserControl.ts` | helper | `browser:do` — one checked capability at a time |
| `src/main/chromium/service.ts` | shared | Registers every capability on the connection |
| `src/main/browserAgent.ts` | shared | Plans a task, step by step, against the real page |

## What Orbis can now do

Every capability the layer has ever had, because they are all registered on this connection:

| Domain | Count | |
| --- | --- | --- |
| `page` | 24 | read, click, type, scroll, find, snapshot, screenshot, select, submit… |
| `tabs` | 10 | create, activate, close, move, pin, mute, list… |
| `devtools` | 9 | |
| `groups` | 8 | create, rename, collapse, add, remove… |
| `downloads`, `bookmarks`, `addressBar` | 6 each | |
| `navigation` | 5 | back, forward, reload, stop, info |
| `browser` | 5 | |
| `history` | 4 | |
| `window`, `settings`, `permissions`, `extensions` | 3 each | |
| `zoom`, `clipboard`, `captcha` | 2 each | |
| `find` | 1 | |

## Two ways in, and why

**`browser:do`** runs one named capability with checked arguments. The panel's tab rows use it; so does the Orb when it
reads the page. Only capabilities on an allow-list can be reached, and every argument is validated before it goes near
the browser — the page names an action, it does not describe one.

**`browser:task`** is for *"open YouTube and find today's report"*. It runs the browser agent: observe the page, decide
a step, ask if the step is consequential, act, check that the page really changed. Every step the Orb shows is a step
that happened.

## The approval gate

A task streams on one request. The answer to *"may I?"* arrives on another (`browser:task-answer`), because a streamed
reply has no way back up the wire.

Only a literal `true` approves. The answer crosses a wire and is whatever the caller sent; `"yes"`, `1`, and an object
are all refused. A gate that accepted whatever looked truthy would be a gate that let a malformed message spend
somebody's money. A task that is stopped refuses everything it was waiting on, rather than leaving an action pending on
an approval nobody will give.

## When there is no browser

The helper still runs, and answers everything that does not need one. Anything that does is refused with that reason.
The Orb asks `browser:task-ready` when its panel opens, so it says *why* it cannot act instead of offering a prompt
that was always going to fail.

If the helper is told to start a browser and cannot, it exits rather than serving. A helper that is up but browserless
looks exactly like a working Orbis that refuses every request — the hardest kind of failure to read.

Closing the browser stops the helper. The helper exists to serve it.
