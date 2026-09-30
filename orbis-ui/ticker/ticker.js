// The market strip.
//
// It draws what Orbis sends and nothing else. There is no sample symbol in this file, no placeholder price and no number
// that did not come from a provider: an empty strip means nothing is configured, and a missing price means the provider
// has none. That is the whole of the honesty requirement, and it is easier to keep than it sounds, because the only source
// of numbers here is the helper.
//
// Three things it is careful about, all of them because this runs all day under whatever somebody is reading:
//
//  - **It moves on the compositor.** One transform on one rail, driven by requestAnimationFrame. Not scrollLeft, not a
//    CSS animation per item, and never a re-render per tick.
//  - **A price update changes text, not structure.** The nodes for an instrument are made once and then written into, so
//    forty instruments updating twice a second does not rebuild forty DOM subtrees.
//  - **It stops when nobody can see it.** Hidden, it cancels the frame loop and tells Orbis to stop sending -- a ticker
//    animating behind a lock screen would be both a waste and a leak.

import { askBrowser, call, HelperDown } from './helper.js'

const $ = (id) => document.getElementById(id)

const strip = $('strip')
const rail = $('rail')
const viewport = $('viewport')
const staticList = $('static')
const groupButton = $('group')
const groupName = $('group-name')
const pauseButton = $('pause')
const stateLabel = $('state')
const peek = $('peek')

/** What Orbis last told us to show. Empty until it does. */
let config = { groupName: '', speed: 40, direction: 'left', pauseOnHover: true, fields: ['price', 'change'], height: 26, enabled: false, slots: 16, auto: true, stillWhenReducedMotion: false }
/** instrumentId -> { instrument, quote } */
let rows = new Map()
/** instrumentId -> the nodes drawn for it, so an update writes text instead of rebuilding. */
const nodes = new Map()

let offset = 0
let running = true
let paused = false
let hovering = false
let lastFrame = 0
let frame = 0
/**
 * Whether the system asks for less motion. Whether that stops the strip is a setting, not an assumption.
 *
 * Everything else obeys the preference without asking, because it exists for people movement makes unwell. A ticker is
 * the ambiguous one: switching on a scrolling strip and choosing its speed is asking for something that moves, and
 * obeying the preference there makes the strip look broken rather than considerate. So the person decides, in Orbis,
 * and both strips read the same answer.
 */
let systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let reduced = false
const settleMotion = () => {
  reduced = systemReduced && config.stillWhenReducedMotion === true
}

// ---------------------------------------------------------------- drawing

const fmtPrice = (value, currency) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // More decimals for the small numbers, fewer for the large ones: a token at 0.000018 and an index at 24,832 cannot
  // share a format, and rounding either to the other's precision loses the number.
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 2 : Math.abs(value) >= 0.01 ? 4 : 8
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits
    }).format(value)
  } catch {
    return value.toFixed(digits)
  }
}

const fmtPercent = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '■'
  return `${arrow} ${sign}${Math.abs(value).toFixed(2)}%`
}

const directionOf = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat')

/** One item's nodes, made once. */
function makeItem(row) {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'item'
  item.dataset.id = row.instrument.instrumentId

  const symbol = document.createElement('span')
  symbol.className = 'item-symbol'
  const price = document.createElement('span')
  price.className = 'item-price'
  const change = document.createElement('span')
  change.className = 'item-change'
  const flag = document.createElement('span')
  flag.className = 'item-flag'

  item.append(symbol, price, change, flag)
  return { item, symbol, price, change, flag }
}

/** Writes a row's current values into its nodes. Never rebuilds them. */
function paint(parts, row, previousPrice) {
  const { instrument, quote } = row
  parts.symbol.textContent = instrument.symbol
  parts.price.textContent = quote ? fmtPrice(quote.last, instrument.currency) : '—'

  const percent = quote?.changePercent ?? null
  parts.change.textContent = fmtPercent(percent)
  parts.change.className = `item-change ${percent === null ? 'flat' : directionOf(percent)}`

  // The freshness, in a word. Nothing is labelled live that is not.
  const freshness = quote?.freshness ?? 'unavailable'
  parts.item.classList.toggle('is-delayed', freshness === 'delayed')
  parts.item.classList.toggle('is-stale', freshness === 'stale')
  parts.flag.textContent = freshness === 'delayed' ? 'delayed' : freshness === 'stale' ? 'stale' : ''

  const label = [
    instrument.name || instrument.symbol,
    quote ? fmtPrice(quote.last, instrument.currency) : 'no price',
    percent === null ? '' : `${percent > 0 ? 'up' : percent < 0 ? 'down' : 'unchanged'} ${Math.abs(percent).toFixed(2)} per cent`,
    freshness === 'real-time' ? '' : freshness
  ]
    .filter(Boolean)
    .join(', ')
  parts.item.setAttribute('aria-label', label)
  parts.item.title = label

  // The flash, only on a real move and only when motion is wanted.
  if (!reduced && previousPrice !== null && quote?.last !== null && quote?.last !== previousPrice) {
    const klass = quote.last > previousPrice ? 'tick-up' : 'tick-down'
    parts.item.classList.remove('tick-up', 'tick-down')
    // Reading offsetWidth restarts the animation; without it a second change inside the animation does nothing visible.
    void parts.item.offsetWidth
    parts.item.classList.add(klass)
  }
}

/**
 * Builds the rail.
 *
 * Twice over, deliberately: the loop resets the transform to zero when the first copy has fully passed, and the second
 * copy is then exactly where the first was. That is what makes the wrap seamless instead of a jump back to the start.
 */
function rebuild() {
  nodes.clear()
  rail.replaceChildren()
  staticList.replaceChildren()

  const items = [...rows.values()]
  if (items.length === 0) {
    stateLabel.className = 'strip-state'
    stateLabel.textContent = 'Nothing selected'
    return
  }

  for (const copy of [0, 1]) {
    for (const row of items) {
      const parts = makeItem(row)
      paint(parts, row, null)
      if (copy === 0) {
        nodes.set(row.instrument.instrumentId, [parts])
        // The still list: the same items, once, for a screen reader and for reduced motion.
        const li = document.createElement('li')
        li.append(parts.item.cloneNode(true))
        staticList.append(li)
      } else {
        // The second copy is decoration; it is hidden from assistive technology so nothing is announced twice.
        parts.item.setAttribute('aria-hidden', 'true')
        parts.item.tabIndex = -1
        nodes.get(row.instrument.instrumentId)?.push(parts)
      }
      rail.append(parts.item)
    }
  }
  // The moving rail is never the accessible copy: a live region that changes every frame cannot be read.
  viewport.setAttribute('aria-hidden', 'true')
  measure()
}

/** Updates one instrument in place. */
function update(instrumentId, quote) {
  const row = rows.get(instrumentId)
  if (!row) return
  const previous = row.quote?.last ?? null
  row.quote = quote
  for (const parts of nodes.get(instrumentId) ?? []) paint(parts, row, previous)
  // The still copy too, which is a clone and so has to be written separately.
  const staticItem = staticList.querySelector(`[data-id="${CSS.escape(instrumentId)}"]`)
  if (staticItem) {
    const parts = {
      item: staticItem,
      symbol: staticItem.querySelector('.item-symbol'),
      price: staticItem.querySelector('.item-price'),
      change: staticItem.querySelector('.item-change'),
      flag: staticItem.querySelector('.item-flag')
    }
    paint(parts, row, previous)
  }
}

// ---------------------------------------------------------------- moving

/** Half the rail: one full copy of the items, which is the distance after which it wraps. */
let lap = 0

function measure() {
  lap = rail.scrollWidth / 2
  // And tell the browser how tall this wants to be, measured rather than assumed.
  const wanted = Math.max(22, Math.ceil(strip.getBoundingClientRect().height || config.height || 26))
  askBrowser('orbis.ticker.height', wanted).catch(() => undefined)
}

function step(now) {
  frame = 0
  if (!running) return
  const elapsed = lastFrame ? Math.min(100, now - lastFrame) : 16
  lastFrame = now

  const moving = !paused && !(hovering && config.pauseOnHover) && !reduced && lap > 0
  if (moving) {
    const pixels = (config.speed * elapsed) / 1000
    offset += config.direction === 'right' ? -pixels : pixels
    // Wrapping at exactly one copy's width is what makes the loop invisible.
    if (offset >= lap) offset -= lap
    if (offset < 0) offset += lap
    rail.style.transform = `translate3d(${-offset}px, 0, 0)`
  }
  frame = requestAnimationFrame(step)
}

function start() {
  if (frame || !running) return
  lastFrame = 0
  frame = requestAnimationFrame(step)
}

function stop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

// ---------------------------------------------------------------- talking to Orbis

/** Which instruments the strip is showing, so Orbis streams those and not everything. */
let watching = []

/**
 * Anything that waits, with a limit.
 *
 * The helper client waits for the browser to hand over Orbis's port, and with Orbis not running that answer never comes --
 * so the first request simply never settled and the strip sat there blank for ever. Blank is the one state that says
 * nothing: a person cannot tell it from a market with no movement. A limit turns it into a sentence.
 */
const within = (ms, work) =>
  Promise.race([work, new Promise((_resolve, reject) => setTimeout(() => reject(new HelperDown('Orbis did not answer.')), ms))])

/**
 * Telling the browser whether the strip is wanted.
 *
 * Only this page can know: it is an Orbis setting, and this page is what can reach Orbis. The browser therefore loads
 * this page hidden and taking no height, and waits to be told -- so saying so is not optional, it is the only thing
 * that makes the band appear at all.
 *
 * Sent on every read rather than only on a change, because a window opened a moment ago has a fresh view that has never
 * been told anything, and a strip that appeared in one window and not the next would be worse than one that never
 * appeared.
 */
const tellBrowser = (wanted) => askBrowser('orbis.ticker.shown', wanted === true).catch(() => undefined)

async function load() {
  try {
    const state = await within(6000, call('markets:ticker', []))
    config = { ...config, ...(state?.config ?? {}) }
    settleMotion()
    void tellBrowser(config.enabled)
    if (!config.enabled) {
      // Off means off: nothing drawn, nothing subscribed, and no long-poll held open for a band that is not there.
      rows = new Map()
      rebuild()
      if (watching.length > 0) {
        watching = []
        await call('markets:watch', [[], 'ticker']).catch(() => undefined)
      }
      running = false
      stop()
      return
    }
    groupName.textContent = config.groupName || 'Markets'
    rows = new Map(
      (state?.items ?? []).map((item) => [item.instrument.instrumentId, { instrument: item.instrument, quote: item.quote ?? null }])
    )
    rebuild()
    strip.classList.toggle('is-static', reduced)
    const ids = [...rows.keys()]
    if (ids.join('|') !== watching.join('|')) {
      watching = ids
      await call('markets:watch', [ids, 'ticker']).catch(() => undefined)
    }
    setState(state?.connection ?? null)
  } catch (err) {
    rows = new Map()
    rebuild()
    setState(err instanceof HelperDown ? 'orbis-down' : 'error')
  }
}

function setState(connection) {
  if (connection === 'orbis-down') {
    stateLabel.className = 'strip-state down'
    stateLabel.textContent = 'Orbis not running'
    return
  }
  if (connection === 'connected' || connection === 'live') {
    stateLabel.className = 'strip-state live'
    stateLabel.textContent = 'Live'
    return
  }
  if (connection === 'delayed') {
    stateLabel.className = 'strip-state delayed'
    stateLabel.textContent = 'Delayed'
    return
  }
  if (connection === 'reconnecting') {
    stateLabel.className = 'strip-state delayed'
    stateLabel.textContent = 'Reconnecting'
    return
  }
  stateLabel.className = 'strip-state down'
  stateLabel.textContent = connection === null ? 'No market data' : 'Disconnected'
}

/**
 * Prices, as they arrive.
 *
 * A long-poll rather than a timer: the helper holds the request open until something changes, so a quiet market costs one
 * open connection and no work at all, and a busy one arrives as fast as it happens.
 */
async function follow() {
  while (running) {
    try {
      // A longer limit than `load`, because this request is meant to be held open until something changes.
      const batch = await within(40_000, call('markets:quotes-since', [watching]))
      if (!running) return
      for (const quote of batch?.quotes ?? []) update(quote.instrumentId, quote)
      for (const fired of batch?.alerts ?? []) {
        for (const parts of nodes.get(fired.instrumentId) ?? []) {
          parts.item.classList.remove('is-alerted')
          void parts.item.offsetWidth
          parts.item.classList.add('is-alerted')
        }
      }
      if (batch?.connection) setState(batch.connection)
    } catch (err) {
      if (!running) return
      setState(err instanceof HelperDown ? 'orbis-down' : 'error')
      // Not a tight loop against a helper that is down.
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// ---------------------------------------------------------------- what somebody does

viewport.addEventListener('pointerenter', () => {
  hovering = true
})
viewport.addEventListener('pointerleave', () => {
  hovering = false
})

pauseButton.addEventListener('click', () => {
  paused = !paused
  pauseButton.setAttribute('aria-pressed', String(paused))
  pauseButton.title = paused ? 'Start the ticker' : 'Pause the ticker'
})

/**
 * Hiding the strip, from the strip.
 *
 * Revealed on hover and at no other time. A permanent close control on a band meant to be glanced at would be the most
 * prominent thing on it, which is the opposite of what a ticker is for.
 *
 * It switches the setting off in Orbis first and only then tells the browser to give the pixels back, in that order: a
 * strip that vanished and came back on the next window would look like a bug rather than a choice.
 */
$('close').addEventListener('click', async () => {
  await call('markets:ticker-off', []).catch(() => undefined)
  config = { ...config, enabled: false }
  running = false
  stop()
  await call('markets:watch', [[], 'ticker']).catch(() => undefined)
  void tellBrowser(false)
})

groupButton.addEventListener('click', () => {
  // The groups live in Orbis, so changing one is Orbis's to do: this asks for the chooser rather than drawing its own.
  call('markets:ticker-groups-open', []).catch(() => undefined)
})

/** Clicking an asset opens the preview, from data already held -- no request, no navigation. */
const openPeek = (instrumentId) => {
  const row = rows.get(instrumentId)
  if (!row) return
  const { instrument, quote } = row
  $('peek-symbol').textContent = instrument.symbol
  $('peek-freshness').textContent = quote?.freshness === 'real-time' ? 'Live' : (quote?.freshness ?? 'unavailable')
  $('peek-price').textContent = quote ? fmtPrice(quote.last, instrument.currency) : 'No price'
  const percent = quote?.changePercent ?? null
  $('peek-change').textContent = percent === null ? '' : `${fmtPercent(percent)}`
  $('peek-change').className = `peek-change ${percent === null ? '' : directionOf(percent)}`

  // Only the fields the provider actually gave. A row that is not there is not shown as a dash-filled row.
  const facts = $('peek-facts')
  facts.replaceChildren()
  const add = (name, value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = fmtPrice(value, name === 'Volume' ? '' : instrument.currency)
    facts.append(dt, dd)
  }
  add('High', quote?.dayHigh ?? null)
  add('Low', quote?.dayLow ?? null)
  add('Volume', quote?.volume ?? null)
  add('Bid', quote?.bid ?? null)
  add('Ask', quote?.ask ?? null)

  $('peek-source').textContent = quote
    ? `${quote.source} · ${new Date(quote.timestamp).toLocaleTimeString()}`
    : 'No provider has a price for this.'
  peek.dataset.id = instrumentId
  peek.hidden = false
}

strip.addEventListener('click', (event) => {
  const item = event.target instanceof Element ? event.target.closest('.item') : null
  if (item?.dataset.id) openPeek(item.dataset.id)
})

$('peek-close').addEventListener('click', () => {
  peek.hidden = true
})

for (const button of peek.querySelectorAll('[data-do]')) {
  button.addEventListener('click', () => {
    const instrumentId = peek.dataset.id
    if (!instrumentId) return
    // Every one of these is a real action in Orbis. Nothing here pretends to do something it cannot.
    call('markets:act', [button.dataset.do, instrumentId]).catch(() => undefined)
    peek.hidden = true
  })
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !peek.hidden) peek.hidden = true
})

// ---------------------------------------------------------------- when nobody can see it

/**
 * Hidden means stopped.
 *
 * The browser hides this view when the strip is switched off or a tab is locked. An animation nobody can see is wasted
 * work, and a market subscription nobody can see is a subscription taken from something that needs it.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    running = false
    stop()
    call('markets:watch', [[], 'ticker']).catch(() => undefined)
  } else if (!running && config.enabled) {
    // Only when the strip is actually wanted. `running` is also false because somebody switched it off, and coming back
    // to the window is not a reason to undo that.
    running = true
    start()
    void load().then(follow)
  }
})

window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  systemReduced = event.matches
  settleMotion()
  strip.classList.toggle('is-static', reduced)
  if (reduced) rail.style.transform = 'translate3d(0,0,0)'
})

window.addEventListener('resize', measure)

// Orbis tells the strip when its configuration changes, so a group switched in Settings appears here without a reload.
globalThis.orbisTickerChanged = () => void load()

// The first read is what tells the browser whether to make room at all. `follow` only begins once there is something to
// follow: a strip that is switched off holds no connection open.
void load().then(() => {
  if (!config.enabled) return
  start()
  return follow()
})
