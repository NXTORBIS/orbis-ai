import type { GameContext, GameInstance, GameModule } from './engine'
import type { Card, Klondike, Move, Pile } from '../../../shared/games/solitaire'
import { applyMove, canFinishItself, dealKlondike, dealRules, finishItself, isKlondike, isRed, legalMoves, movableRun, RANK_NAMES, sendHome, stuck, SUIT_SIGNS, SUITS, winBonus, won } from '../../../shared/games/solitaire'

interface Saved {
  game: Klondike
  seconds: number
}

/** The thirteen places the keyboard can be: the stock, the waste, the four suits, and the seven columns. */
type Slot = Pile | { kind: 'stock' }
const SLOTS: Slot[] = [{ kind: 'stock' }, { kind: 'waste' }, ...SUITS.map((_, index) => ({ kind: 'foundation', index }) as Pile), ...Array.from({ length: 7 }, (_, index) => ({ kind: 'tableau', index }) as Pile)]
const FIRST_COLUMN = SLOTS.findIndex((one) => one.kind === 'tableau')

/**
 * Klondike solitaire. Seven columns, four suits to build up from the ace, and a stock you turn over in threes -- or in
 * ones, on the easy setting, which is the only honest way to make this game easier.
 *
 * Click a card to pick it up and a pile to put it down; double-click sends a card home. Everything can be done from
 * the keyboard as well: the arrows move between the piles, up and down change how many cards of a column you are
 * holding, Enter picks up and puts down, and Space turns the stock over.
 *
 * When nothing can be played any more the game says so, and it only says it after looking: every card left in the
 * stock is walked past once before "no moves left" appears, because in threes the card that saves you is often four
 * draws away.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'klon'
  surface.appendChild(root)

  const rules = dealRules(ctx.prefs.difficulty)
  let game = dealKlondike(Math.random, rules.drawCount, rules.maxRecycles)
  let history: Klondike[] = []
  let pick: { pile: Pile; count: number } | null = null
  let slot = FIRST_COLUMN
  let hold = 1
  let seconds = 0
  let clock = 0
  let paused = false
  let finished = false
  /** Whether the game is under way, so a game picked up again can be paused before its first move. */
  let live = false
  let note = ''

  const same = (a: Pile, b: Pile): boolean => a.kind === b.kind && (a.kind === 'waste' || b.kind === 'waste' || ('index' in a && 'index' in b && a.index === b.index))
  /** Whether the keyboard marker is on this pile. */
  const isHere = (pile: Pile | { kind: 'stock' }): boolean => {
    const here = SLOTS[slot]
    if (here.kind !== pile.kind) return false
    if (here.kind === 'waste' || here.kind === 'stock') return true
    return 'index' in here && 'index' in pile && here.index === pile.index
  }

  const emit = (): void =>
    ctx.emit({
      status: finished ? 'over' : paused ? 'paused' : live || history.length ? 'running' : 'ready',
      score: game.score,
      elapsedMs: seconds * 1000,
      difficulty: 1,
      hud: [
        { label: 'Home', value: `${game.foundations.reduce((n, pile) => n + pile.length, 0)} of 52` },
        { label: 'Moves', value: game.moves },
        { label: 'Time', value: `${seconds}s` }
      ]
    })

  const saveNow = (): void => {
    if (!finished && history.length) ctx.save?.({ game, seconds } satisfies Saved)
  }

  const startClock = (): void => {
    if (clock) return
    clock = window.setInterval(() => {
      if (paused || finished) return
      seconds++
      if (seconds % 10 === 0) saveNow()
      emit()
    }, 1000)
  }

  // ---------------------------------------------------------------- drawing the table

  const cardFace = (card: Card, extra: string): HTMLElement => {
    const el = document.createElement('div')
    el.className = `klon-card ${card.up ? (isRed(card.suit) ? 'red' : 'black') : 'down'}${extra}`
    if (card.up) {
      const rank = document.createElement('span')
      rank.className = 'klon-rank'
      rank.textContent = RANK_NAMES[card.rank]
      const suit = document.createElement('span')
      suit.className = 'klon-suit'
      suit.textContent = SUIT_SIGNS[card.suit]
      el.append(rank, suit)
      el.setAttribute('aria-label', `${RANK_NAMES[card.rank]} of ${card.suit}`)
    } else el.setAttribute('aria-label', 'Face down')
    return el
  }

  const pileEl = (pile: Pile, className: string, label: string): HTMLElement => {
    const el = document.createElement('div')
    el.className = className + (isHere(pile) ? ' here' : '')
    el.dataset.pile = pile.kind
    if ('index' in pile) el.dataset.index = String(pile.index)
    el.setAttribute('aria-label', label)
    return el
  }

  const render = (): void => {
    root.replaceChildren()

    const top = document.createElement('div')
    top.className = 'klon-top'

    const stock = document.createElement('div')
    stock.className = `klon-slot klon-stock${isHere({ kind: 'stock' }) ? ' here' : ''}`
    stock.dataset.pile = 'stock'
    stock.setAttribute('aria-label', game.stock.length ? `Stock, ${game.stock.length} cards` : 'Stock, empty')
    if (game.stock.length) stock.appendChild(cardFace({ suit: 'spades', rank: 1, up: false }, ''))
    else {
      const turn = document.createElement('span')
      turn.className = 'klon-again'
      turn.textContent = game.waste.length ? (game.maxRecycles < 0 || game.recycles < game.maxRecycles ? '↻' : '✕') : ''
      stock.appendChild(turn)
    }
    top.appendChild(stock)

    const waste = pileEl({ kind: 'waste' }, 'klon-slot klon-waste', game.waste.length ? `Waste, ${RANK_NAMES[game.waste[game.waste.length - 1].rank]} of ${game.waste[game.waste.length - 1].suit} on top` : 'Waste, empty')
    game.waste.slice(-3).forEach((card, i, shown) => {
      const held = pick?.pile.kind === 'waste' && i === shown.length - 1
      const el = cardFace(card, `${held ? ' held' : ''} klon-fan`)
      el.style.setProperty('--klon-fan', String(i))
      el.dataset.card = String(game.waste.length - shown.length + i)
      waste.appendChild(el)
    })
    top.appendChild(waste)

    const spacer = document.createElement('div')
    spacer.className = 'klon-gap'
    top.appendChild(spacer)

    SUITS.forEach((suit, index) => {
      const pile = game.foundations[index]
      const el = pileEl({ kind: 'foundation', index }, 'klon-slot klon-foundation', pile.length ? `${suit}, up to ${RANK_NAMES[pile[pile.length - 1].rank]}` : `${suit}, empty`)
      const sign = document.createElement('span')
      sign.className = `klon-ghost${isRed(suit) ? ' red' : ''}`
      sign.textContent = SUIT_SIGNS[suit]
      el.appendChild(sign)
      if (pile.length) el.appendChild(cardFace(pile[pile.length - 1], ''))
      top.appendChild(el)
    })
    root.appendChild(top)

    const table = document.createElement('div')
    table.className = 'klon-table'
    game.tableau.forEach((column, index) => {
      const el = pileEl({ kind: 'tableau', index }, 'klon-column', column.length ? `Column ${index + 1}, ${column.length} cards` : `Column ${index + 1}, empty`)
      el.style.setProperty('--klon-count', String(Math.max(1, column.length)))
      const holding = pick?.pile.kind === 'tableau' && pick.pile.index === index ? pick.count : 0
      column.forEach((card, i) => {
        const held = holding > 0 && i >= column.length - holding
        const marked = !pick && isHere({ kind: 'tableau', index }) && i === column.length - Math.min(hold, Math.max(1, movableRun(column)))
        const face = cardFace(card, `${held ? ' held' : ''}${marked ? ' marked' : ''}`)
        face.style.setProperty('--klon-i', String(i))
        face.dataset.card = String(i)
        el.appendChild(face)
      })
      table.appendChild(el)
    })
    root.appendChild(table)

    const bar = document.createElement('div')
    bar.className = 'klon-bar'
    const text = document.createElement('span')
    text.className = 'klon-note'
    text.textContent = note || (pick ? `Holding ${pick.count} card${pick.count === 1 ? '' : 's'} · click where it goes` : `${game.stock.length} in the stock · ${game.drawCount} at a time`)
    const undoButton = document.createElement('button')
    undoButton.type = 'button'
    undoButton.className = 'klon-btn'
    // Not in the tab order on purpose: the keys belong to the table while it has focus, and U does this.
    undoButton.tabIndex = -1
    undoButton.dataset.action = 'undo'
    undoButton.textContent = 'Undo (U)'
    undoButton.disabled = !history.length || finished
    bar.append(text, undoButton)
    root.appendChild(bar)
    emit()
  }

  // ---------------------------------------------------------------- playing

  const say = (text: string): void => {
    note = text
  }

  const endGame = (): void => {
    finished = true
    window.clearInterval(clock)
    clock = 0
    ctx.save?.(null)
    const score = won(game) ? game.score + winBonus(seconds) : game.score
    render()
    ctx.over({ score, extra: { difficulty: ctx.prefs.difficulty } })
  }

  /** After every move: a finished game, a game that can finish itself, or a game with nothing left in it. */
  const settle = (): void => {
    if (won(game)) {
      say(`Out in ${game.moves} moves and ${seconds} seconds.`)
      ctx.audio.blip(1040, 320, 'sine')
      endGame()
      return
    }
    if (canFinishItself(game)) {
      game = finishItself(game)
      if (won(game)) {
        say('Nothing left to decide, so the rest went home by itself.')
        ctx.audio.blip(980, 300, 'sine')
        endGame()
        return
      }
    }
    if (stuck(game)) {
      say('No moves left. Every card in the stock has been looked at.')
      ctx.audio.blip(160, 360, 'sawtooth')
      endGame()
      return
    }
    render()
    saveNow()
  }

  const play = (move: Move, sound: number): boolean => {
    const next = applyMove(game, move)
    if (!next) return false
    history.push(game)
    if (history.length > 300) history.shift()
    game = next
    pick = null
    note = ''
    live = true
    startClock()
    ctx.audio.blip(sound, 35, 'triangle', 0.4)
    settle()
    return true
  }

  const home = (from: Pile): boolean => {
    const next = sendHome(game, from)
    if (!next) return false
    history.push(game)
    game = next
    pick = null
    note = ''
    live = true
    startClock()
    ctx.audio.blip(820, 60, 'sine', 0.5)
    settle()
    return true
  }

  const useStock = (): void => {
    if (game.stock.length) {
      play({ kind: 'draw' }, 420)
      return
    }
    if (!game.waste.length) {
      say('The stock is empty and so is the pile beside it.')
      render()
      return
    }
    if (!play({ kind: 'recycle' }, 300)) {
      say(`That is the last time round the stock on this setting.`)
      render()
    }
  }

  /** Picking a card up, or putting down what is already held. */
  const touch = (pile: Pile, cardIndex?: number): void => {
    if (paused || finished) return
    if (pick) {
      if (same(pick.pile, pile)) {
        pick = null
        render()
        return
      }
      if (pile.kind === 'waste') {
        say('Cards leave that pile; they never go back on it.')
        pick = null
        render()
        return
      }
      if (!play({ kind: 'move', from: pick.pile, count: pick.count, to: pile }, 520)) {
        say('That card cannot go there.')
        pick = null
        render()
      }
      return
    }
    if (pile.kind === 'foundation') {
      const top = game.foundations[pile.index]
      if (!top.length) return
      pick = { pile, count: 1 }
      say('')
      render()
      return
    }
    if (pile.kind === 'waste') {
      if (!game.waste.length) return
      pick = { pile, count: 1 }
      say('')
      render()
      return
    }
    const column = game.tableau[pile.index]
    if (!column.length) return
    const run = movableRun(column)
    const from = cardIndex === undefined ? column.length - 1 : cardIndex
    const count = Math.min(column.length - from, run)
    if (count < 1) {
      say('That card is face down.')
      render()
      return
    }
    pick = { pile, count }
    say('')
    render()
  }

  const undo = (): void => {
    const previous = history.pop()
    if (!previous || finished) return
    game = previous
    pick = null
    say('')
    ctx.audio.blip(380, 40, 'sine', 0.35)
    render()
    saveNow()
  }

  // ---------------------------------------------------------------- input

  const pileFrom = (el: HTMLElement): Pile | null => {
    const kind = el.dataset.pile
    if (kind === 'waste') return { kind: 'waste' }
    if (kind === 'foundation') return { kind: 'foundation', index: Number(el.dataset.index) }
    if (kind === 'tableau') return { kind: 'tableau', index: Number(el.dataset.index) }
    return null
  }

  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('[data-action="undo"]')) return undo()
    const holder = target.closest<HTMLElement>('[data-pile]')
    if (!holder) return
    if (holder.dataset.pile === 'stock') return useStock()
    const pile = pileFrom(holder)
    if (!pile) return
    const card = target.closest<HTMLElement>('.klon-card')
    touch(pile, card?.dataset.card === undefined ? undefined : Number(card.dataset.card))
  }

  const onDouble = (e: MouseEvent): void => {
    const holder = (e.target as HTMLElement).closest<HTMLElement>('[data-pile]')
    if (!holder || holder.dataset.pile === 'stock') return
    const pile = pileFrom(holder)
    if (!pile) return
    pick = null
    if (!home(pile)) {
      say('That card has nowhere to go home to yet.')
      render()
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const stop = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      stop()
      const step = e.code === 'ArrowLeft' ? -1 : 1
      slot = (slot + step + SLOTS.length) % SLOTS.length
      hold = 1
      render()
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      stop()
      const here = SLOTS[slot]
      if (here && here.kind === 'tableau') {
        const run = Math.max(1, movableRun(game.tableau[here.index]))
        hold = Math.min(run, Math.max(1, hold + (e.code === 'ArrowUp' ? 1 : -1)))
        render()
      }
      return
    }
    if (e.code === 'Space') {
      stop()
      useStock()
      return
    }
    if (e.code === 'Enter') {
      stop()
      const here = SLOTS[slot]
      if (here.kind === 'stock') return useStock()
      if (!pick && here.kind === 'tableau') {
        const column = game.tableau[here.index]
        if (column.length) {
          const count = Math.min(hold, Math.max(1, movableRun(column)))
          touch(here, column.length - count)
          return
        }
      }
      touch(here)
      return
    }
    if (e.code === 'KeyU') {
      stop()
      undo()
      return
    }
    if (e.code === 'KeyF') {
      stop()
      const here = SLOTS[slot]
      if (here.kind !== 'foundation' && here.kind !== 'stock' && !home(here)) {
        say('That card has nowhere to go home to yet.')
        render()
      }
    }
  }

  root.addEventListener('click', onClick)
  root.addEventListener('dblclick', onDouble)
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    window.clearInterval(clock)
    clock = 0
    game = dealKlondike(Math.random, rules.drawCount, rules.maxRecycles)
    history = []
    pick = null
    slot = FIRST_COLUMN
    hold = 1
    seconds = 0
    paused = false
    finished = false
    live = false
    note = `Click a card to pick it up. ${game.drawCount === 1 ? 'The stock turns one at a time.' : 'The stock turns three at a time.'}`
    render()
  }

  return {
    start: fresh,
    restart() {
      ctx.save?.(null)
      fresh()
    },
    pause() {
      if (paused || finished) return
      paused = true
      saveNow()
      render()
    },
    resume() {
      if (!paused) return
      paused = false
      render()
    },
    restore(saved) {
      const s = saved as Saved
      if (!s || !isKlondike(s.game) || won(s.game)) return false
      game = s.game
      history = []
      pick = null
      seconds = Math.max(0, Math.round(Number(s.seconds) || 0))
      finished = false
      paused = false
      live = true
      // A saved game with nothing left in it would be a dead end to hand somebody.
      if (!legalMoves(game).length) return false
      note = 'Picked up where you left off.'
      startClock()
      render()
      return true
    },
    destroy() {
      saveNow()
      window.clearInterval(clock)
      root.removeEventListener('click', onClick)
      root.removeEventListener('dblclick', onDouble)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The table is a CSS grid; it sizes itself.
    }
  }
}

const solitaire: GameModule = { id: 'solitaire', surface: 'dom', create }
export default solitaire
