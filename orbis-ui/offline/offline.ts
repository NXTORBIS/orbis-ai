import { GAMES, drawDotGrid, GRID, type Game, type GameId, type GameKey, type Palette, type PointerKind } from '../../src/shared/imageGames.ts'

/**
 * Something to do while a page will not load.
 *
 * The browser's error page used to carry Chromium's dinosaur; the dinosaur is switched off in this build, which left
 * the page with nothing on it but a sentence. This is Orbis's own, and it is deliberately the SAME four games the chat
 * shows while it is drawing a picture -- the same file, src/shared/imageGames.ts, not a second copy of them. Waiting
 * for a page and waiting for a picture are the same moment, so they look the same and play the same.
 *
 * What it will not do:
 *
 * **It never hides the reason.** The error Chromium wrote stays exactly where it was, above this. A game that covered
 * "this site cannot be reached" would be a game that stopped somebody fixing their connection.
 *
 * **It never starts by itself.** Nothing moves until a key is pressed or the board is touched, so a page that failed
 * while somebody was reading something else does not start animating in a background tab.
 *
 * **It keeps nothing but a best score**, per game, in this page's own storage. There is no account, nothing is sent
 * anywhere, and a browser with storage switched off simply has no best score rather than an error.
 */

const KEYS: Record<string, GameKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'action',
  Enter: 'action'
}

/** The look, read from the page itself so the game wears whatever the error page is wearing, light or dark. */
function paletteOf(root: HTMLElement): Palette {
  const styles = getComputedStyle(root)
  const pick = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim()
    return value || fallback
  }
  return {
    accent: pick('--accent', '#3fd8ff'),
    ink: pick('--text', '#e8f4ff'),
    muted: pick('--muted', '#8ea0b5'),
    danger: pick('--red', '#ff4d6d'),
    bg: pick('--bg-mid', '#0b1016')
  }
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    // A browser with storage switched off. There is simply no best score, which is not a failure worth saying.
    return null
  }
}

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Nothing to do and nothing to say: the score was for this sitting anyway.
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface OfflineGame {
  destroy(): void
}

/**
 * Puts the game under whatever the error page is already saying.
 *
 * `host` is the element to append to. Nothing above it is touched or read, so a change to Chromium's own error markup
 * cannot break this and this cannot break that.
 */
export function mountOfflineGame(host: HTMLElement): OfflineGame {
  const root = el('div', 'orbis-offline')
  const head = el('div', 'orbis-offline-head')
  const title = el('p', 'orbis-offline-title', 'While you wait')
  const picker = el('div', 'orbis-offline-games')
  const scores = el('p', 'orbis-offline-score')
  head.append(title, picker, scores)

  const board = el('div', 'orbis-offline-board')
  const canvas = el('canvas', 'orbis-offline-canvas')
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'application')
  const hint = el('p', 'orbis-offline-hint')
  board.append(canvas, hint)
  root.append(head, board)
  host.append(root)

  const saved = read('orbis.offlineGame')
  let chosen: GameId = GAMES.find((one) => one.id === saved)?.id ?? 'snake'
  let game: Game = GAMES.find((one) => one.id === chosen)!.create()
  let score = 0
  let best = Number(read(`orbis.offlineGame.best.${chosen}`) ?? 0) || 0
  let started = false
  let frame = 0
  let last = 0
  let grid: HTMLCanvasElement | null = null
  let palette = paletteOf(document.documentElement)
  let size = 0

  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const sayScore = (): void => {
    scores.textContent = best > 0 ? `Score ${score} · best ${best}` : `Score ${score}`
  }

  const sayHint = (): void => {
    const words = started ? game.hint() : 'Press a key or touch the board to start'
    hint.textContent = words ?? ''
    hint.hidden = !words
  }

  const fit = (): void => {
    const box = board.getBoundingClientRect()
    const side = Math.max(160, Math.floor(Math.min(box.width, box.height)))
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    size = side
    canvas.width = Math.floor(side * ratio)
    canvas.height = Math.floor(side * ratio)
    canvas.style.width = `${side}px`
    canvas.style.height = `${side}px`
    palette = paletteOf(document.documentElement)
    grid = drawDotGrid(Math.floor(side * ratio), palette)
  }

  const draw = (): void => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const px = canvas.width
    ctx.clearRect(0, 0, px, px)
    if (grid) ctx.drawImage(grid, 0, 0)
    game.draw(ctx, px, palette)
  }

  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick)
    const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000)
    last = now
    if (started) game.update(dt)
    draw()
    const now2 = game.score()
    if (now2 !== score) {
      score = now2
      if (score > best) {
        best = score
        write(`orbis.offlineGame.best.${chosen}`, String(best))
      }
      sayScore()
    }
    sayHint()
  }

  const begin = (): void => {
    if (started) return
    started = true
    sayHint()
  }

  const choose = (id: GameId): void => {
    chosen = id
    write('orbis.offlineGame', id)
    game = GAMES.find((one) => one.id === id)!.create()
    score = 0
    started = false
    best = Number(read(`orbis.offlineGame.best.${id}`) ?? 0) || 0
    for (const button of picker.querySelectorAll('button')) {
      const on = button.dataset.game === id
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    sayScore()
    sayHint()
    draw()
    canvas.focus()
  }

  for (const one of GAMES) {
    const button = el('button', 'orbis-offline-game', one.label)
    button.type = 'button'
    button.dataset.game = one.id
    button.setAttribute('aria-pressed', one.id === chosen ? 'true' : 'false')
    if (one.id === chosen) button.classList.add('on')
    button.addEventListener('click', () => choose(one.id))
    picker.append(button)
  }

  const onKey = (event: KeyboardEvent): void => {
    const key = KEYS[event.code]
    if (!key) return
    // Only while the board has the keyboard, so arrow keys still scroll the page everywhere else.
    if (document.activeElement !== canvas) return
    event.preventDefault()
    begin()
    game.key(key)
  }

  const at = (event: PointerEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect()
    return { x: (event.clientX - box.left) / Math.max(1, box.width), y: (event.clientY - box.top) / Math.max(1, box.height) }
  }
  const onPointer = (kind: PointerKind) => (event: PointerEvent): void => {
    if (kind === 'down') {
      canvas.focus()
      begin()
    }
    const where = at(event)
    game.pointer(kind, where.x, where.y)
  }

  const down = onPointer('down')
  const move = onPointer('move')
  const up = onPointer('up')
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  document.addEventListener('keydown', onKey)

  const watcher = new ResizeObserver(() => {
    fit()
    draw()
  })
  watcher.observe(board)

  fit()
  sayScore()
  sayHint()
  draw()
  /*
   * Drawn every frame.
   *
   * Before the first key the games do not move -- `update` is only called once something has started them -- so this
   * costs a redraw of a still picture and nothing else. Somebody who has asked for less movement gets exactly that
   * from the games themselves rather than from a blank square where the board should be.
   */
  void still
  frame = requestAnimationFrame(tick)

  canvas.setAttribute('aria-label', `${GAMES.find((one) => one.id === chosen)?.label ?? 'Game'}. Arrow keys or space to play. The grid is ${GRID} by ${GRID}.`)

  return {
    destroy(): void {
      cancelAnimationFrame(frame)
      watcher.disconnect()
      document.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      root.remove()
    }
  }
}

declare global {
  interface Window {
    orbisOfflineGame?: (host: HTMLElement) => OfflineGame
  }
}

// How Chromium's own error page starts it: one function on the window, called from neterror.ts where the dinosaur used
// to be started. Nothing here runs on its own, so a page that is not an error page never builds a game.
window.orbisOfflineGame = mountOfflineGame
