/**
 * The furniture the Orbis-only screens share.
 *
 * Five screens sit on top of this file: what Orbis noticed while you were browsing, the DJ and its stations and what
 * Orbis has worked out about you, what you have been listening to, bringing music in, and the settings. They are the
 * parts of Orbis Music that no streaming app has an equivalent of, so they are the parts most easily turned into
 * afterthoughts, and they are built from the same few pieces here rather than five slightly different versions of a
 * heading and a card.
 *
 * It is a file of my own because the frame does not have these: `dom.ts` gives a node and a button, `shell.ts` gives
 * a track row, and everything between -- a titled block, a card, a switch, a row of choices, a measured figure -- was
 * not there. Every class it writes begins `om-own-`, so nothing here can reach into another screen's rules.
 *
 * Two habits it keeps, both from the frame it plugs into. Nothing is ever parsed as markup: every node is made one at
 * a time. And nothing shows a figure that was not measured: a block with no answer says so in a sentence, and a
 * missing number is left out rather than drawn as a zero.
 */

import { emptyWords, type EmptyReason } from '../../../src/shared/music/fulltab.ts'
import type { Answer } from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'

/** A titled block down a screen. The detail line is the one chance to say what the block is for, so it is used. */
export function block(title: string, detail: string, children: readonly (Node | null | false)[], action?: Node | null): HTMLElement {
  return el('section', { cls: 'om-own-block' }, [
    el('div', { cls: 'om-own-block-head' }, [
      el('div', {}, [el('h2', { cls: 'om-own-block-title', text: title }), detail ? el('p', { cls: 'om-own-block-detail', text: detail }) : null]),
      action ?? null
    ]),
    ...children
  ])
}

/** The big heading at the top of a screen. */
export const screenHead = (title: string, detail: string): HTMLElement =>
  el('header', { cls: 'om-own-head' }, [el('h1', { cls: 'om-own-title', text: title }), detail ? el('p', { cls: 'om-own-lead', text: detail }) : null])

/** A raised panel: the light line along its top edge is what makes it read as an object rather than a rectangle. */
export const card = (cls: string, children: readonly (Node | string | null | false)[]): HTMLElement => el('div', { cls: `om-own-card ${cls}`.trim() }, children)

/**
 * A measured figure, with what it counts underneath it.
 *
 * Only ever called with a number Orbis actually counted. A figure nobody measured has no tile: the screen leaves the
 * space empty and says why, which is the honest answer and the house style.
 */
export const figure = (count: string, what: string): HTMLElement =>
  el('div', { cls: 'om-own-figure' }, [el('span', { cls: 'om-own-figure-count', text: count }), el('span', { cls: 'om-own-figure-what', text: what })])

/** A row of figures. */
export const figures = (children: readonly (Node | null | false)[]): HTMLElement => el('div', { cls: 'om-own-figures' }, children)

/** A preference that is on or off, with the sentence saying what it does underneath its name. */
export function toggleRow(options: {
  readonly label: string
  readonly detail?: string
  readonly on: boolean
  readonly onChange: (on: boolean) => void
  readonly disabled?: boolean
}): HTMLElement {
  const press = button(
    {
      cls: `om-own-switch${options.on ? ' om-on' : ''}`,
      attrs: { role: 'switch', 'aria-checked': String(options.on), disabled: options.disabled ? true : null },
      label: options.label,
      onClick: () => options.onChange(!options.on)
    },
    [el('span', { cls: 'om-own-switch-dot', attrs: { 'aria-hidden': 'true' } })]
  )
  return el('div', { cls: 'om-own-row' }, [
    el('div', { cls: 'om-own-row-words' }, [
      el('span', { cls: 'om-own-row-label', text: options.label }),
      options.detail ? el('span', { cls: 'om-own-row-detail', text: options.detail }) : null
    ]),
    press
  ])
}

/** One of several things to pick from, drawn as pills. `chosen` may be null for a setting Orbis does not keep. */
export function choices<T extends string>(options: {
  readonly label: string
  readonly detail?: string
  readonly items: readonly { readonly id: T; readonly label: string; readonly blurb?: string }[]
  readonly chosen: T | null
  readonly onPick: (id: T) => void
}): HTMLElement {
  return el('div', { cls: 'om-own-row om-own-row-stack' }, [
    el('div', { cls: 'om-own-row-words' }, [
      el('span', { cls: 'om-own-row-label', text: options.label }),
      options.detail ? el('span', { cls: 'om-own-row-detail', text: options.detail }) : null
    ]),
    el(
      'div',
      { cls: 'om-own-choices', attrs: { role: 'group', 'aria-label': options.label } },
      options.items.map((item) =>
        button(
          {
            cls: `om-own-choice${item.id === options.chosen ? ' om-on' : ''}`,
            attrs: { 'aria-pressed': options.chosen === null ? null : String(item.id === options.chosen) },
            title: item.blurb,
            onClick: () => options.onPick(item.id)
          },
          [el('span', { cls: 'om-own-choice-label', text: item.label }), item.blurb ? el('span', { cls: 'om-own-choice-blurb', text: item.blurb }) : null]
        )
      )
    )
  ])
}

/** A bar for a measured reading, 0 to 100, with the number beside it because a bar alone cannot be read exactly. */
export function readingBar(name: string, value: number, firm: boolean): HTMLElement {
  return el('div', { cls: `om-own-reading${firm ? '' : ' om-own-reading-soft'}` }, [
    el('span', { cls: 'om-own-reading-name', text: name }),
    el('span', { cls: 'om-own-reading-rail', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { cls: 'om-own-reading-fill', style: { '--om-own-fill': `${value}%` } })
    ]),
    el('span', { cls: 'om-own-reading-value', text: String(value), attrs: { 'aria-label': `${name}: ${value} out of 100` } })
  ])
}

/** A plain button that does something and says what the music service said about it. */
export const press = (label: string, onClick: () => void, kind: 'primary' | 'quiet' | 'normal' = 'normal', iconName?: string): HTMLButtonElement =>
  button({ cls: `om-btn${kind === 'primary' ? ' om-btn-primary' : kind === 'quiet' ? ' om-btn-quiet' : ''}`, onClick }, [
    iconName ? icon(iconName, 16) : null,
    el('span', { text: label })
  ])

/**
 * A button for something that cannot be undone, which asks first.
 *
 * It asks in place: the first press turns the button into the question, and the second press does it. Deliberately
 * not the browser's own confirm box, which the panel before this page used -- that box is a different program's
 * dialog, it cannot be styled, it cannot say what Orbis is about to throw away in Orbis's own words, and it stops
 * everything else on the page while it is up. The question goes back to the label after a few seconds, so a press
 * nobody meant to make expires rather than waiting about to be pressed again.
 */
export function carefulPress(label: string, question: string, onYes: () => void, iconName?: string): HTMLButtonElement {
  let asking = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const node: HTMLButtonElement = button({ cls: 'om-btn om-btn-quiet' }, [iconName ? icon(iconName, 16) : null, el('span', { text: label })])
  const settle = (): void => {
    asking = false
    node.classList.remove('om-own-asking')
    fill(node, iconName ? icon(iconName, 16) : null, el('span', { text: label }))
  }
  node.addEventListener('click', () => {
    if (asking) {
      if (timer) clearTimeout(timer)
      settle()
      onYes()
      return
    }
    asking = true
    node.classList.add('om-own-asking')
    fill(node, el('span', { text: question }))
    timer = setTimeout(settle, 6000)
  })
  return node
}

/**
 * Turns an answer into either a value or the right sentence about why there is none.
 *
 * The one rule the whole page turns on: a call that failed must never leave an empty list on screen, because an empty
 * list reads as "you have no music" and somebody will believe it. The Orbis window being shut is its own state with
 * its own sentence, told apart from a library that really is empty.
 */
export function unwrap<T>(answer: Answer<T>, what: string): { readonly value: T } | { readonly problem: HTMLElement } {
  if (answer.got) return { value: answer.value }
  const reason: EmptyReason = answer.shut ? 'unreachable' : 'failed'
  const words = emptyWords(reason, what, answer.why)
  return { problem: says(words.title, words.detail) }
}

/** The sentence a block shows while it is still waiting for its first answer. */
export const reading = (what: string): HTMLElement => says(emptyWords('loading', what).title)

/** The sentence for a block that has its answer and the answer is that there is nothing. */
export const nothingYet = (what: string, detail = ''): HTMLElement => says(emptyWords('empty', what).title, detail)
