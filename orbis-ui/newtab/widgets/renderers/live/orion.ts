import type { WidgetContext } from '../../api.ts'
import { clear, h, svg } from '../../dom.ts'
import { inert } from './parts.ts'

/**
 * A way to ask Orion without leaving the start page.
 *
 * A box, a button, and a mark beside them: three rings around a lit core, drawn rather than drawn from anywhere.
 * It is Orbis's own shape and it means nothing on its own, so it is left out of what a screen reader reads -- the
 * box says what it is for, and a glowing orb announced before every question would be read a hundred times a day.
 *
 * The question goes to Orion and the answer opens beside the page. Nothing is answered here: this widget has no
 * model, keeps no history, and says only what Orion said back about the asking.
 */

/** Suggestions fill the box and stop there. Pressing one is not asking: the person still decides to send it. */
const STARTERS: readonly string[] = Object.freeze(['What can you do?', 'Plan my day', 'Help me write something'])

let made = 0

/**
 * The mark: a lit core, three tilted rings, and three points going slowly round.
 *
 * Every colour is the accent at a different strength, so it is the same mark in a dark theme and a light one, and it
 * follows whatever accent the person chose in Orbis rather than a blue picked once and baked in.
 */
function orb(): SVGElement {
  const id = `wg-orb-${(made += 1)}`
  const node = svg('svg', { class: 'wg-orion-orb', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' })
  node.appendChild(svg('defs', null,
    svg('radialGradient', { id },
      svg('stop', { class: 'wg-orion-stop-in', offset: '0%' }),
      svg('stop', { class: 'wg-orion-stop-mid', offset: '46%' }),
      svg('stop', { class: 'wg-orion-stop-out', offset: '100%' }))))
  node.appendChild(svg('circle', { class: 'wg-orion-glow', cx: 50, cy: 50, r: 46, fill: `url(#${id})` }))
  for (const tilt of [-26, 34, 86]) {
    node.appendChild(svg('ellipse', { class: 'wg-orion-ring', cx: 50, cy: 50, rx: 34, ry: 12.5, transform: `rotate(${tilt} 50 50)` }))
  }
  const sparks = svg('g', { class: 'wg-orion-sparks' })
  for (let turn = 0; turn < 3; turn += 1) {
    const angle = (turn * 2 * Math.PI) / 3
    sparks.appendChild(svg('circle', { class: 'wg-orion-spark', cx: (50 + Math.cos(angle) * 31).toFixed(2), cy: (50 + Math.sin(angle) * 31).toFixed(2), r: 2.2 }))
  }
  node.appendChild(sparks)
  node.appendChild(svg('circle', { class: 'wg-orion-core', cx: 50, cy: 50, r: 13 }))
  node.appendChild(svg('circle', { class: 'wg-orion-shine', cx: 45, cy: 45, r: 4.4 }))
  return node
}

export function orion(ctx: WidgetContext): void {
  const prompt = String(ctx.settings.prompt ?? '')
  const roomy = ctx.size === 'wide' || ctx.size === 'large'
  clear(ctx.body)

  const root = h('form', { class: 'wg-orion', 'data-size': ctx.size, ...(ctx.still ? { 'data-still': '' } : {}) })
  root.appendChild(orb())

  const box = inert(h('input', {
    class: 'wg-orion-box',
    type: 'text',
    autocomplete: 'off',
    maxlength: 400,
    placeholder: prompt,
    'aria-label': 'Ask Orion'
  }), ctx.preview)

  const send = inert(h('button', { class: 'wg-btn primary wg-orion-send', type: 'submit', text: 'Ask' }), ctx.preview)
  const answer = h('p', { class: 'wg-orion-answer', role: 'status', 'aria-live': 'polite' })

  // Nothing to ask is nothing to send, so the button says so rather than failing once it is pressed.
  const ready = (): void => {
    if (ctx.preview) return
    send.disabled = box.value.trim() === ''
  }
  box.addEventListener('input', ready)
  ready()

  // The box, the suggestions and whatever Orion said back are one column, so a full row can set them beside the mark
  // and a smaller card can set them under it without the renderer laying the card out twice.
  const stack = h('div', { class: 'wg-orion-stack' },
    h('div', { class: 'wg-orion-middle' }, h('span', { class: 'wg-orion-field' }, box), send))
  root.appendChild(stack)

  if (roomy) {
    const row = h('div', { class: 'wg-orion-starters' })
    for (const starter of STARTERS) {
      const chip = inert(h('button', { class: 'wg-chip wg-orion-starter', type: 'button', text: starter }), ctx.preview)
      chip.addEventListener('click', () => {
        box.value = starter
        ready()
        box.focus()
      })
      row.appendChild(chip)
    }
    stack.appendChild(row)
  }

  stack.appendChild(answer)

  root.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = box.value.trim()
    if (text === '' || ctx.preview) return
    send.disabled = true
    answer.textContent = 'Asking Orion…'
    void ctx.run({ do: 'orion.ask', text }).then((result) => {
      // Orion's own words when it has any; otherwise the plain fact and no more, which is that the question went.
      answer.textContent = result.message ?? (result.ok ? 'Asked Orion.' : 'Orion could not be asked.')
      if (result.ok) box.value = ''
      ready()
    })
  })

  ctx.body.appendChild(root)
}
