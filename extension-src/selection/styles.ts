/**
 * How the selection orb and its palette look.
 *
 * One string, put into a closed shadow root. That matters as much as anything it says: the page cannot read these
 * rules, cannot override them, and cannot style anything of Orbis's into looking like part of itself. Nothing here
 * inherits from the page either, so a site with `* { font-family: Comic Sans }` does not get to dress the orb.
 *
 * The colours are Orbis's, written out rather than taken from tokens, because this runs on somebody else's page where
 * no Orbis stylesheet is loaded. They follow the system's light and dark setting, which is what the page around them
 * is doing too.
 */
export const SELECTION_STYLES = `
:host {
  all: initial;
  --orb: 18px;
  --accent: #3fd8ff;
  --ink: #e8eaed;
  --muted: #9aa0a6;
  --faint: #6c7a86;
  --panel: #16181c;
  --panel-edge: rgba(255, 255, 255, 0.11);
  --amber: #ffc24b;
  --red: #ff6b7a;
  --shadow: 0 10px 34px rgba(0, 0, 0, 0.44), 0 2px 8px rgba(0, 0, 0, 0.3);
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
    --ink: #1a1d21;
    --muted: #5f6771;
    --faint: #878f99;
    --panel: #ffffff;
    --panel-edge: rgba(0, 0, 0, 0.1);
    --accent: #0a93bd;
    --shadow: 0 10px 30px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.1);
  }
}

.orb,
.panel {
  position: absolute;
  pointer-events: auto;
  box-sizing: border-box;
}

/* ---------------------------------------------------------------- the orb */

.orb {
  display: grid;
  place-items: center;
  width: var(--orb);
  height: var(--orb);
  padding: 0;
  color: #04222c;
  background: radial-gradient(circle at 34% 30%, #bdf2ff 0%, var(--accent) 48%, #1aa6cc 100%);
  border: 0;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
  cursor: pointer;
  animation: orb-in 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.orb:hover {
  transform: scale(1.14);
}

.orb:active {
  transform: scale(0.94);
}

.orb:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.orb svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.2;
}

@keyframes orb-in {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
}

/* ---------------------------------------------------------------- the palette and the answer */

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 6px;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: 14px;
  box-shadow: var(--shadow);
  animation: panel-in 130ms cubic-bezier(0.2, 0.9, 0.3, 1);
}

.panel[data-from='above'] {
  transform-origin: bottom left;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
  }
}

.ask {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 1px 0 5px;
  padding: 8px 11px;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  border: 1px solid var(--panel-edge);
  border-radius: 9px;
}

.ask::placeholder {
  color: var(--faint);
}

.ask:focus {
  outline: none;
  border-color: var(--accent);
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--ink);
  background: none;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
}

.row:hover,
.row[data-on='yes'] {
  background: color-mix(in srgb, var(--ink) 9%, transparent);
}

.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.row svg {
  flex: none;
  width: 15px;
  height: 15px;
  color: var(--muted);
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
}

.rule {
  height: 1px;
  margin: 5px 4px;
  background: var(--panel-edge);
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
  padding: 3px 4px 7px;
}

.head .what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.icon-btn {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
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
  padding: 0 4px 4px;
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}

.answer[data-state='failed'] {
  color: var(--red);
}

.quoted {
  margin: 0 4px 8px;
  padding: 6px 9px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  border-left: 2px solid var(--accent);
  border-radius: 0 7px 7px 0;
}

.feet {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 7px 4px 1px;
}

.feet .spacer {
  flex: 1;
}

.chip {
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--muted);
  background: none;
  border: 1px solid var(--panel-edge);
  border-radius: 999px;
  cursor: pointer;
}

.chip:hover {
  color: var(--ink);
  border-color: var(--accent);
}

.chip[data-kind='stop'] {
  color: var(--amber);
  border-color: color-mix(in srgb, var(--amber) 45%, transparent);
}

.waiting {
  display: inline-block;
  width: 7px;
  height: 13px;
  vertical-align: text-bottom;
  background: var(--accent);
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* ---------------------------------------------------------------- the line that says something happened */

.toast {
  position: absolute;
  padding: 7px 13px;
  font-size: 12.5px;
  pointer-events: none;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: 999px;
  box-shadow: var(--shadow);
  animation: panel-in 130ms ease-out;
}

.toast[data-tone='bad'] {
  color: var(--red);
}

/* Somebody who has asked for less movement gets none of it, and everything still works the same. */
@media (prefers-reduced-motion: reduce) {
  .orb,
  .panel,
  .toast {
    animation: none;
  }

  .orb:hover,
  .orb:active {
    transform: none;
  }

  .waiting {
    animation: none;
  }
}
`
