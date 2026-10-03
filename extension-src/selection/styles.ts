/**
 * How the selection orb and its palette look.
 *
 * One string, put into a closed shadow root. That matters as much as anything it says: the page cannot read these
 * rules, cannot override them, and cannot style anything of Orbis's into looking like part of itself. Nothing here
 * inherits from the page either, so a site with `* { font-family: Comic Sans }` does not get to dress the orb.
 *
 * The look is Orbis's own: a dark glass disc with a lit ring turning slowly inside it, and a panel that grows out of
 * that disc rather than appearing somewhere near it. Everything that moves, moves with `transform` and `opacity`
 * only -- this is injected into every page on the web, and a redesign that cost a frame of someone's scrolling would
 * not be worth having.
 *
 * The colours are written out rather than taken from tokens, because this runs on somebody else's page where no
 * Orbis stylesheet is loaded. They follow the system's light and dark setting, which is what the page around them is
 * doing too. And every single thing that moves is switched off under `prefers-reduced-motion`, where the whole design
 * still has to work -- which is why nothing here uses motion to say something the colour and the shape do not.
 */
export const SELECTION_STYLES = `
:host {
  all: initial;
  --orb: 22px;
  --accent: #3fd8ff;
  --accent-deep: #0f8fb8;
  --ink: #eef2f6;
  --muted: #9aa7b4;
  --faint: #6b7886;
  --panel: #10141a;
  --panel-edge: rgba(255, 255, 255, 0.1);
  --glow: rgba(63, 216, 255, 0.5);
  --amber: #ffc24b;
  --red: #ff6b7a;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.4);
  --font: -apple-system, 'Segoe UI', system-ui, sans-serif;

  position: fixed;
  inset: 0;
  z-index: 2147483646;
  /* The host covers the window so its children can be placed anywhere in it, and lets every click it does not want
     fall straight through to the page. Only the orb and the panel below take pointer events back. */
  pointer-events: none;
  font-family: var(--font);
  color: var(--ink);
}

@media (prefers-color-scheme: light) {
  :host {
    --ink: #10151b;
    --muted: #5b6672;
    --faint: #8a95a1;
    --panel: #ffffff;
    --panel-edge: rgba(16, 21, 27, 0.1);
    --accent: #0a93bd;
    --accent-deep: #0a93bd;
    --glow: rgba(10, 147, 189, 0.32);
    --shadow: 0 16px 40px rgba(16, 21, 27, 0.18), 0 2px 8px rgba(16, 21, 27, 0.1);
  }
}

.orb,
.panel,
.toast {
  position: absolute;
  pointer-events: auto;
  box-sizing: border-box;
}

/* ---------------------------------------------------------------- the orb */

/*
 * A small dark disc with a lit ring turning inside it.
 *
 * Three layers, because one flat circle on a page full of other circles is invisible: the halo says something is
 * there, the ring says it is Orbis, and the mark says what it does. The halo is the only one that is allowed to grow
 * past the disc, so the thing you can click is exactly the thing you can see.
 */
.orb {
  display: grid;
  place-items: center;
  width: var(--orb);
  height: var(--orb);
  padding: 0;
  color: var(--accent);
  background: radial-gradient(circle at 50% 36%, rgba(63, 216, 255, 0.26), rgba(5, 9, 13, 0.97) 72%);
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  isolation: isolate;
  animation: orb-in 220ms cubic-bezier(0.2, 0.9, 0.3, 1.25);
  transition: transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

@media (prefers-color-scheme: light) {
  .orb {
    background: radial-gradient(circle at 50% 42%, #ffffff, #eaf6fb 70%);
  }
}

/* The ring: a bright arc that turns, so the orb reads as alive without anything jumping about. */
.orb::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0deg, var(--accent) 60deg, #ffffff 92deg, var(--accent) 125deg, transparent 210deg, transparent 360deg);
  /* Only the rim is painted: the middle is cut out so the mark underneath stays readable. */
  mask: radial-gradient(circle, transparent 0 58%, #000 60%);
  -webkit-mask: radial-gradient(circle, transparent 0 58%, #000 60%);
  animation: orb-turn 4.5s linear infinite;
  z-index: -1;
}

/* The halo. Outside the disc, never catching a click, and the only part that reacts to being approached. */
.orb::after {
  content: '';
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle, var(--glow) 0%, transparent 68%);
  opacity: 0.55;
  transition: opacity 160ms ease, transform 160ms ease;
  z-index: -2;
}

.orb:hover {
  transform: scale(1.16);
}

.orb:hover::after {
  opacity: 1;
  transform: scale(1.18);
}

.orb:active {
  transform: scale(0.93);
}

.orb:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

/* The mark itself, kept brighter than everything behind it so it reads as a mark rather than a highlight on a bead. */
.orb svg {
  width: 13px;
  height: 13px;
  color: #f2fdff;
  stroke-width: 2.2;
  filter: drop-shadow(0 0 5px var(--glow));
}

@media (prefers-color-scheme: light) {
  .orb svg {
    color: var(--accent-deep);
  }
}

@keyframes orb-in {
  from {
    opacity: 0;
    transform: scale(0.3);
  }
}

@keyframes orb-turn {
  to {
    transform: rotate(360deg);
  }
}

/* ---------------------------------------------------------------- the palette */

/*
 * Glass, with a lit edge along the top.
 *
 * It grows from the corner nearest the orb, which is what makes it read as *that selection's* panel rather than
 * something that appeared nearby. "data-from" is set by the placement code to whichever side it opened on, so the
 * corner it grows from is always the one the orb is at.
 */
.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 7px;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  border: 1px solid var(--panel-edge);
  border-radius: 16px;
  box-shadow: var(--shadow), 0 0 0 1px rgba(63, 216, 255, 0.07), 0 0 28px -8px var(--glow);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  transform-origin: top left;
  animation: panel-in 190ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.panel[data-from='above'] {
  transform-origin: bottom left;
}

/* A thread of light along the top edge, brightest where the orb is. Decoration only; it never takes a click. */
.panel::before {
  content: '';
  position: absolute;
  top: 0;
  right: 14%;
  left: 0;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, var(--accent), transparent);
  opacity: 0.75;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(-4px);
  }
}

/*
 * The rows arrive a beat apart.
 *
 * Each carries its own position as --i, so the list reads top to bottom the way an eye does. It is 18ms apart: enough
 * to feel like one movement rather than six, and short enough that the last row is there before a hand reaches it.
 */
.row,
.ask,
.rule,
.note {
  animation: row-in 180ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
  animation-delay: calc(var(--i, 0) * 18ms);
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
}

/* ---------------------------------------------------------------- what you selected */

/*
 * A line of the text the palette is about.
 *
 * Worth the space: the panel can open over a long page after the selection has scrolled, and "explain" means nothing
 * without "explain what". The accent bar is the thread back to the orb.
 */
.about {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 1px 2px 6px;
  padding: 5px 9px;
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  border-left: 2px solid var(--accent);
  border-radius: 0 8px 8px 0;
  animation: row-in 180ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.about span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* ---------------------------------------------------------------- asking anything */

.ask {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 1px 0 6px;
  padding: 9px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  border: 1px solid var(--panel-edge);
  border-radius: 11px;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}

.ask::placeholder {
  color: var(--faint);
}

.ask:focus {
  outline: none;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

/* ---------------------------------------------------------------- the actions */

.row {
  display: flex;
  position: relative;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 450;
  text-align: left;
  color: var(--ink);
  background: none;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.row:hover,
.row[data-on='yes'] {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}

.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/*
 * The icon sits in its own tile, which lights up under the pointer.
 *
 * It gives the eye one thing to travel down rather than six loose marks, and it is what makes the hovered row look
 * pressed-into rather than merely tinted.
 */
.row svg {
  flex: none;
  box-sizing: content-box;
  width: 15px;
  height: 15px;
  padding: 5px;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  border-radius: 8px;
  transition: color 120ms ease, background 120ms ease, transform 160ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
}

.row:hover svg {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  transform: scale(1.08);
}

.row .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row .more-mark {
  flex: none;
  color: var(--faint);
  transition: transform 140ms ease, color 120ms ease;
}

.row:hover .more-mark {
  color: var(--accent);
  transform: translateX(2px);
}

.rule {
  height: 1px;
  margin: 5px 6px;
  background: linear-gradient(90deg, transparent, var(--panel-edge) 20%, var(--panel-edge) 80%, transparent);
}

.note {
  margin: 0;
  padding: 7px 10px 4px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--muted);
}

.note[data-tone='warn'] {
  color: var(--amber);
}

/* ---------------------------------------------------------------- the answer */

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 8px;
}

/* A lit dot while the answer is arriving, which stops the moment it has. */
.head .live {
  flex: none;
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--glow);
  animation: live-beat 1.4s ease-in-out infinite;
}

@keyframes live-beat {
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}

.head .what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.icon-btn {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}

.icon-btn:hover {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 10%, transparent);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.answer {
  flex: 1;
  /* Enough for two lines even before anything has arrived, so an answer is never squeezed into a sliver. */
  min-height: 42px;
  padding: 0 5px 4px;
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 22%, transparent) transparent;
}

.answer[data-state='failed'] {
  color: var(--red);
}

.quoted {
  margin: 0 4px 9px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  border-left: 2px solid var(--accent);
  border-radius: 0 8px 8px 0;
}

.feet {
  display: flex;
  flex: none;
  gap: 6px;
  align-items: center;
  padding: 8px 4px 1px;
}

.feet .spacer {
  flex: 1;
}

.chip {
  padding: 5px 11px;
  font: inherit;
  font-size: 12px;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 5%, transparent);
  border: 1px solid var(--panel-edge);
  border-radius: 999px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.chip:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
}

.chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.chip[data-kind='stop'] {
  color: var(--amber);
  border-color: color-mix(in srgb, var(--amber) 42%, transparent);
}

.chip[data-kind='stop']:hover {
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 12%, transparent);
}

/*
 * While there is nothing to show yet.
 *
 * Three dots that rise in turn, rather than a block that blinks. A blinking block reads as a broken cursor; this
 * reads as something being composed, which is what is happening.
 */
.waiting {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 15px;
  vertical-align: text-bottom;
}

.waiting i {
  width: 5px;
  height: 5px;
  background: var(--accent);
  border-radius: 50%;
  opacity: 0.35;
  animation: waiting-rise 1.1s ease-in-out infinite;
}

.waiting i:nth-child(2) {
  animation-delay: 0.14s;
}

.waiting i:nth-child(3) {
  animation-delay: 0.28s;
}

@keyframes waiting-rise {
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* ---------------------------------------------------------------- the line that says something happened */

.toast {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 8px 14px;
  font-size: 12.5px;
  pointer-events: none;
  background: color-mix(in srgb, var(--panel) 86%, transparent);
  border: 1px solid var(--panel-edge);
  border-radius: 999px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  animation: panel-in 190ms cubic-bezier(0.16, 1, 0.3, 1);
}

.toast::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--glow);
}

.toast[data-tone='bad'] {
  color: var(--red);
}

.toast[data-tone='bad']::before {
  background: var(--red);
  box-shadow: 0 0 8px rgba(255, 107, 122, 0.6);
}

/*
 * Somebody who has asked for less movement gets none of it, and everything still works the same.
 *
 * Every rule above that moves is switched off here, including the ones that are the whole character of the design --
 * the turning ring, the beating dot, the rising dots. What is left still says everything it needs to with colour and
 * shape, which is the test of whether the motion was decoration or meaning.
 */
@media (prefers-reduced-motion: reduce) {
  .orb,
  .panel,
  .toast,
  .row,
  .ask,
  .rule,
  .note,
  .about,
  .orb::before,
  .head .live,
  .waiting i {
    animation: none;
  }

  .orb,
  .orb:hover,
  .orb:active,
  .orb:hover::after,
  .row:hover svg,
  .row:hover .more-mark {
    transform: none;
  }

  .waiting i {
    opacity: 0.8;
  }
}

/* ---------------------------------------------------------------- the contextual bar */
/*
 * What a selection produces, straight away: three words above the words they are about.
 *
 * Compact on purpose. It sits over somebody's reading, so it is the size of a line of text and no larger, and it
 * never covers the selection -- the placement arithmetic puts it above, or below when there is no room above.
 */
.bar {
  position: fixed;
  pointer-events: auto;
  z-index: 2147483647;
  display: flex;
  align-items: stretch;
  padding: 2px;
  border: 1px solid var(--panel-edge);
  border-radius: 10px;
  background: var(--panel);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  font: 500 12.5px/1 var(--font);
  color: var(--ink);
  white-space: nowrap;
  transform-origin: bottom left;
  animation: bar-in 120ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

/* Growing from the edge nearest the words, so it reads as coming out of the selection rather than landing on it. */
.bar[data-from='below'] {
  transform-origin: top left;
}

@keyframes bar-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.bar-act {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 7px 11px;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}

.bar-act:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}

.bar-act:active {
  transform: translateY(0.5px);
}

.bar-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* A hairline between actions, the way the reference puts one. Not a border on the button: that would double up. */
.bar-line {
  align-self: center;
  width: 1px;
  height: 15px;
  background: var(--panel-edge);
}

.bar-none {
  padding: 7px 11px;
  color: var(--faint);
}

/* High contrast: glass is not a border, and a bar that depends on blur disappears entirely here. */
@media (forced-colors: active) {
  .bar {
    background: Canvas;
    border-color: CanvasText;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .bar-act:hover {
    background: Highlight;
    color: HighlightText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    animation: none;
  }
  .bar-act {
    transition: none;
  }
}

@media (prefers-color-scheme: light) {
  /* On a light panel a white wash is invisible; the hover has to go the other way. */
  .bar-act:hover {
    background: rgba(10, 20, 30, 0.08);
    color: #10151b;
  }
}


`
