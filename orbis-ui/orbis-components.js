// Small vanilla helpers over orbis.css. No dependencies.
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
export const button = (label, kind = '', onClick) => { const b = el('button', `o-btn ${kind}`, label); if (onClick) b.onclick = onClick; return b }
export const toast = (msg, ms = 2500) => { const t = el('div', 'o-toast', msg); t.setAttribute('role', 'status'); document.body.append(t); setTimeout(() => t.remove(), ms) }
export const state = (kind, msg) => el('div', `o-state ${kind === 'error' ? 'error' : ''}`, msg)
export function tabs(defs, onSelect) {
  const bar = el('div', 'o-tabs'); bar.setAttribute('role', 'tablist')
  defs.forEach((d, i) => { const t = el('button', 'o-tab', d.label); t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', i === 0); t.onclick = () => { bar.querySelectorAll('.o-tab').forEach((x) => x.setAttribute('aria-selected', x === t)); onSelect(d.id) }; bar.append(t) })
  return bar
}
