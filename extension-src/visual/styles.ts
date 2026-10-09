/**
 * How Orbis Visual Search looks.
 *
 * One string, put into a closed shadow root. That matters as much as anything it says: the page cannot read these
 * rules, cannot override them, and cannot style anything of Orbis's into looking like part of itself. Nothing here
 * inherits from the page either, so a site with `* { font-family: Comic Sans }` does not get to dress the selection.
 *
 * The look is Orbis's own and is built from four ideas, not from a glass rectangle:
 *
 * **The dimming is a mask, not four rectangles.** The region outside the selection is darkened by one element with a
 * hole cut in it, which means the selected pixels are untouched -- no overlay over them, nothing to lighten, nothing
 * that could be a quarter of a shade off. What you are looking at is exactly what will be sent.
 *
 * **The frame is thin and lit at the corners.** A heavy border hides the edge of what was selected, which is the one
 * thing the frame exists to show. The corners carry the weight instead, and they double as the handles.
 *
 * **The Vision Core is the anchor.** A small lit point at the selection's corner that the bar grows out of and the
 * result returns to, so the answer reads as having come from those pixels rather than from somewhere on the page.
 *
 * **Everything that moves, moves with `transform` and `opacity`.** This is injected into every page on the web, and a
 * redesign that cost a frame of someone's scrolling would not be worth having.
 *
 * The colours are written out rather than taken from tokens, because this runs on somebody else's page where no
 * Orbis stylesheet is loaded. They follow the system's light and dark setting, which is what the page around them is
 * doing too. And every single thing that moves is switched off under `prefers-reduced-motion`, where the whole design
 * still has to work -- which is why nothing here uses motion to say something the colour and the shape do not.
 */
export const VISUAL_STYLES = `
:host {
  all: initial;
  --accent: #3fd8ff;
  --accent-deep: #0f8fb8;
  --ink: #eef2f6;
  --muted: #9aa7b4;
  --faint: #6b7886;
  --panel: #0e1217;
  --panel-soft: #151b22;
  --panel-edge: rgba(255, 255, 255, 0.11);
  --glow: rgba(63, 216, 255, 0.5);
  --amber: #ffc24b;
  --red: #ff6b7a;
  --veil: rgba(6, 9, 13, 0.52);
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.4);
  --font: -apple-system, 'Segoe UI', system-ui, sans-serif;
  --mono: ui-monospace, 'Cascadia Mono', 'Consolas', monospace;

  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: var(--font);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: light) {
  :host {
    --ink: #0f141a;
    --muted: #55606c;
    --faint: #838e9a;
    --panel: #ffffff;
    --panel-soft: #f4f6f9;
    --panel-edge: rgba(15, 20, 26, 0.12);
    --accent: #0a93bd;
    --accent-deep: #077a9e;
    --glow: rgba(10, 147, 189, 0.3);
    --veil: rgba(14, 20, 28, 0.34);
    --shadow: 0 16px 40px rgba(16, 21, 27, 0.18), 0 2px 8px rgba(16, 21, 27, 0.1);
  }
}

* { box-sizing: border-box; }

/* The whole layer takes the pointer only while a selection is being made or exists. Idle it is nothing at all, so a
   page behaves exactly as it would without Orbis. */
.layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.layer.live { pointer-events: auto; cursor: crosshair; }
.layer.holding { cursor: grabbing; }

/* ---------------------------------------------------------------- the dimming */

/*
 * One element with a hole cut in it.
 *
 * \`clip-path\` with an outer rectangle and an inner one wound the other way leaves the selection entirely untouched:
 * no layer over it, nothing to tint it, nothing that could make the pixels on screen differ from the pixels sent.
 * The first attempt was four rectangles around the selection, and their seams showed as hairlines at some zooms.
 */
.veil {
  position: absolute;
  inset: 0;
  background: var(--veil);
  backdrop-filter: saturate(0.85) blur(0.5px);
  transition: opacity 140ms ease;
  opacity: 0;
}
.veil.on { opacity: 1; }

/* ---------------------------------------------------------------- the frame */

.frame {
  position: absolute;
  border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.35),
    0 0 22px -2px var(--glow),
    inset 0 0 18px -8px var(--glow);
  border-radius: 3px;
  pointer-events: none;
}
.frame.holding { border-style: dashed; }

/* The corners: four short lines rather than four dots, so they read as a frame and not as decoration. */
.corner {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: auto;
  border: 0 solid var(--accent);
}
.corner::after {
  content: '';
  position: absolute;
  inset: -7px;
}
.corner.nw { border-top-width: 2px; border-left-width: 2px; border-top-left-radius: 3px; cursor: nwse-resize; }
.corner.ne { border-top-width: 2px; border-right-width: 2px; border-top-right-radius: 3px; cursor: nesw-resize; }
.corner.sw { border-bottom-width: 2px; border-left-width: 2px; border-bottom-left-radius: 3px; cursor: nesw-resize; }
.corner.se { border-bottom-width: 2px; border-right-width: 2px; border-bottom-right-radius: 3px; cursor: nwse-resize; }

/* The inside of the selection, which is draggable. Invisible: the frame is what you see. */
.grip {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  background: transparent;
}

/* The size, shown while dragging. It is the one number that genuinely helps during a drag. */
.size {
  position: absolute;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  color: var(--muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono);
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow);
}

/* ---------------------------------------------------------------- the Vision Core */

/*
 * A small lit point at the selection's corner.
 *
 * It is the thing the bar grows out of and the result comes back to, and its state is said with colour and shape
 * rather than with motion -- so that switching the motion off (below) loses nothing but the flourish.
 */
.core {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent), 0 0 16px var(--glow);
  pointer-events: none;
}
.core.scanning { animation: core-scan 1.1s ease-in-out infinite; }
.core.thinking { animation: core-think 1.6s ease-in-out infinite; }
.core.failed { background: var(--red); box-shadow: 0 0 0 3px rgba(255, 107, 122, 0.22); }
.core.done { background: #4ade80; box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.22); }

@keyframes core-scan {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.5); }
}
@keyframes core-think {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* The scanning line: one gradient band travelling down the selection while the picture is being looked at. */
.scan {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  border-radius: 3px;
}
.scan i {
  position: absolute;
  left: 0;
  right: 0;
  height: 34%;
  background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 26%, transparent), transparent);
  animation: scan-down 1.5s linear infinite;
}
@keyframes scan-down {
  from { transform: translateY(-120%); }
  to { transform: translateY(320%); }
}

/* ---------------------------------------------------------------- the bar */

.bar {
  position: absolute;
  pointer-events: auto;
  width: 384px;
  max-width: calc(100vw - 24px);
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  transform-origin: top left;
  animation: bar-in 170ms cubic-bezier(0.17, 0.84, 0.44, 1);
}
.bar.from-above { transform-origin: bottom left; }
@keyframes bar-in {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to { opacity: 1; transform: none; }
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.row + .row { border-top: 1px solid var(--panel-edge); }

.mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.mark b {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 7px var(--glow);
}

input.ask {
  all: unset;
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  caret-color: var(--accent);
}
input.ask::placeholder { color: var(--faint); }

.go {
  all: unset;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--panel);
  background: var(--accent);
  transition: transform 90ms ease, opacity 90ms ease;
}
.go:hover { opacity: 0.88; }
.go:active { transform: scale(0.94); }
.go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.go[disabled] { opacity: 0.35; cursor: default; }
.go svg { width: 13px; height: 13px; }

.shut {
  all: unset;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--faint);
  cursor: pointer;
}
.shut:hover { color: var(--ink); background: var(--panel-soft); }
.shut:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.shut svg { width: 12px; height: 12px; }

/* The quick actions. A row that wraps rather than scrolls: a scrolling strip hides half of itself. */
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--panel-edge);
}
.act {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--panel-edge);
  background: var(--panel-soft);
  color: var(--ink);
  font-size: 11.5px;
  cursor: pointer;
  transition: border-color 100ms ease, color 100ms ease;
}
.act:hover { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.act:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.act[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
.act svg { width: 11px; height: 11px; opacity: 0.8; }
.act.lead { background: color-mix(in srgb, var(--accent) 16%, var(--panel-soft)); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }

/* ---------------------------------------------------------------- what it is doing */

.doing {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-top: 1px solid var(--panel-edge);
  color: var(--muted);
  font-size: 11.5px;
}
.doing .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: core-think 1.4s ease-in-out infinite;
}
.doing .stop {
  all: unset;
  margin-left: auto;
  color: var(--faint);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.doing .stop:hover { color: var(--ink); }
.doing .stop:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---------------------------------------------------------------- the answer */

.found {
  max-height: min(52vh, 460px);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: 1px solid var(--panel-edge);
  scrollbar-width: thin;
}
.found::-webkit-scrollbar { width: 9px; }
.found::-webkit-scrollbar-thumb { background: var(--panel-edge); border-radius: 5px; }

.head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 10px 8px;
}
.thumb {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: 7px;
  border: 1px solid var(--panel-edge);
  object-fit: cover;
  background: var(--panel-soft);
  cursor: zoom-in;
}
.thumb.big {
  width: 100%;
  height: auto;
  max-height: 40vh;
  object-fit: contain;
  cursor: zoom-out;
}
.about { min-width: 0; flex: 1 1 auto; }
.title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.kind {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--faint);
  font-size: 11px;
}
.kind .sure { color: var(--muted); }
.kind .sure.low { color: var(--amber); }

.prose {
  padding: 0 10px 9px;
  font-size: 12.5px;
  line-height: 1.52;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.prose em { color: var(--muted); font-style: normal; }

.caret {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: var(--accent);
  animation: core-think 1s steps(2) infinite;
}

.details { margin: 0 10px 9px; padding: 0; list-style: none; }
.details li {
  position: relative;
  padding-left: 11px;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.45;
}
.details li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.52em;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent-deep);
}

.words {
  margin: 0 10px 9px;
  padding: 7px 8px;
  border-radius: 7px;
  background: var(--panel-soft);
  border: 1px solid var(--panel-edge);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 160px;
  overflow-y: auto;
  color: var(--muted);
}

/* Suggested next questions. Three at most, and they are buttons, because that is what they do. */
.next { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 9px; }
.ask-next {
  all: unset;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px dashed var(--panel-edge);
  color: var(--muted);
  font-size: 11.5px;
  cursor: pointer;
}
.ask-next:hover { border-style: solid; border-color: color-mix(in srgb, var(--accent) 50%, transparent); color: var(--ink); }
.ask-next:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* A found address: shown before anything opens it. Never followed on its own. */
.address {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 10px 9px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--panel-soft);
  border: 1px solid var(--panel-edge);
  font-size: 11px;
}
.address code {
  font-family: var(--mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

/* ---------------------------------------------------------------- when it goes wrong */

.wrong { padding: 10px; border-top: 1px solid var(--panel-edge); }
.wrong p {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink);
}
.wrong .why {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--red);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ---------------------------------------------------------------- the quiet lines */

.note {
  padding: 7px 10px;
  border-top: 1px solid var(--panel-edge);
  color: var(--faint);
  font-size: 11px;
  line-height: 1.45;
}
.note.warn { color: var(--amber); }
.model { color: var(--faint); font-size: 10.5px; font-variant-numeric: tabular-nums; }

/* The toast, for an action that finished with nothing to show. */
.toast {
  position: absolute;
  pointer-events: auto;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  box-shadow: var(--shadow);
  font-size: 12px;
  max-width: 320px;
  animation: bar-in 150ms ease;
}

/* The first-use hint. One line, once, and never again. */
.hint {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px 7px 12px;
  border-radius: 999px;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  box-shadow: var(--shadow);
  font-size: 12px;
  color: var(--muted);
  animation: bar-in 200ms ease;
}
.hint b { color: var(--ink); font-weight: 600; }

/* ---------------------------------------------------------------- motion off */

@media (prefers-reduced-motion: reduce) {
  .veil, .bar, .toast, .hint { transition: none; animation: none; }
  .core, .core.scanning, .core.thinking, .doing .dot, .caret { animation: none; }
  /* The scanning band is removed rather than stilled: a frozen gradient in the middle of the selection says nothing
     and covers something. What it was saying is said by the line of text beside it instead. */
  .scan { display: none; }
}

/* ---------------------------------------------------------------- high contrast */

@media (forced-colors: active) {
  .bar, .toast, .hint { border: 1px solid CanvasText; background: Canvas; }
  .frame { border-color: Highlight; box-shadow: none; }
  .corner { border-color: Highlight; }
  .core { background: Highlight; box-shadow: none; }
  .act, .ask-next { border-color: CanvasText; }
  .go { background: Highlight; color: Canvas; }
}
`
