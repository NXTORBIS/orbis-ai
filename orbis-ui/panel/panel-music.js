import { call } from './helper.js'

/**
 * Orbis Music, in the Orbis panel.
 *
 * This is the browser's own music surface: what is playing, the library, the queue, playlists, and the song playing on
 * the page in front of you. It belongs to Orbis and sits in Orbis's own panel -- a website's player is never touched,
 * never wrapped and never replaced, and nothing from here is put onto a web page.
 *
 * ## The distinctions this screen has to keep
 *
 * **Whose sound is this.** A track of your own playing through Orbis Music and a song playing on a web page are two
 * different things, and the panel says which. Orbis can see a page's sound and can ask it to pause; it does not own
 * it.
 *
 * **Noticing is not owning.** A song recognised on a page shows an "Add to Orbis Music" button. Pressing it either
 * links the copy you already have or keeps the name with "no audio on this computer" said plainly. Nothing is
 * downloaded, nothing is converted, and the button never says "Added" before the library says so.
 *
 * **It never shows an empty library when it does not know.** Everything here comes from the Orbis window's own store.
 * With that closed, this says so -- an empty list would read as "you have no music", which somebody would believe.
 *
 * **Everything on screen is one state.** The player here, the player on the new tab page and the player in the Orbis
 * window are views of the same thing, read back after every press rather than guessed at.
 */

const root = document.getElementById('music')

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false))
  return node
}

let state = null
let heard = null
let view = 'now'
let library = []
let playlists = []
let recent = []
let problem = ''
let busy = ''
let search = ''
let said = ''
let timer = null
/** What a search came back with, including which providers could not be asked. */
let found = null
let finding = false
let explorations = []
let sources = []
let dna = null
let plan = null
/** Why the track playing was chosen, asked for rather than guessed. */
let why = null

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    // "Orbis is not running" and "you have no music" are completely different answers, and this is the first.
    problem = err?.message || 'That did not work.'
    return null
  }
}

/**
 * Asks Orbis Music to do something, by name.
 *
 * The same runner the Orbis window reaches, so "surprise me" here and "surprise me" there are one piece of code
 * rather than two that drift apart.
 */
const ask = (op, a, b, c) => run('music:do', [op, a, b, c])

/** A length as somebody would say it. Zero or unknown is a dash, never "0:00" pretending to be a length. */
const length = (seconds) => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = String(whole % 60).padStart(2, '0')
  if (minutes < 60) return `${minutes}:${rest}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`
}

/** What a track can be said about its audio, in plain words. */
const availability = (track) => {
  switch (track.availability) {
    case 'local':
      return { label: 'On this computer', tone: 'good' }
    case 'reference':
      return { label: 'No audio here', tone: 'warn' }
    case 'missing':
      return { label: 'File missing', tone: 'bad' }
    default:
      return { label: 'Cannot be played', tone: 'bad' }
  }
}


/* ---- the look: art tiles, the equaliser, icons --------------------------------------------------------------------- */
const ICONS = {
 "edit": {"a": {"fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "width": "18", "height": "18"}, "k": [{"d": "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"}]},
 "list": {"a": {"fill": "none", "stroke": "currentColor", "stroke-width": "2", "stroke-linecap": "round", "width": "18", "height": "18"}, "k": [{"d": "M4 6h12M4 12h12M4 18h8M19 15v6M16 18h6"}]},
 "prev": {
  "a": {
   "width": "20",
   "height": "20",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M6 5h2v14H6zM20 5v14L9 12z"
   }
  ]
 },
 "next": {
  "a": {
   "width": "20",
   "height": "20",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M16 5h2v14h-2zM4 5v14l11-7z"
   }
  ]
 },
 "play": {
  "a": {
   "width": "26",
   "height": "26",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M8 5v14l11-7z"
   }
  ]
 },
 "pause": {
  "a": {
   "width": "26",
   "height": "26",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M6 5h4v14H6zM14 5h4v14h-4z"
   }
  ]
 },
 "shuffle": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"
   }
  ]
 },
 "repeat": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "m17 2 4 4-4 4"
   },
   {
    "d": "M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"
   },
   {
    "d": "M21 13v1a4 4 0 0 1-4 4H3"
   }
  ]
 },
 "heart": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.5 1 4.6 2.6C12.1 6 13.6 5 15.6 5 19 5 21.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z",
    "transform": "translate(0 -.5)"
   }
  ]
 },
 "volume": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
   }
  ]
 },
 "mute": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"
   }
  ]
 },
 "plus": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round"
  },
  "k": [
   {
    "d": "M12 5v14M5 12h14"
   }
  ]
 },
 "note": {
  "a": {
   "width": "22",
   "height": "22",
   "fill": "currentColor"
  },
  "k": [
   {
    "d": "M9 3v11.3A3.5 3.5 0 1 0 11 17.5V8h6V3z"
   }
  ]
 },
 "file": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
   },
   {
    "d": "M14 3v5h5"
   }
  ]
 },
 "folder": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
   }
  ]
 },
 "ear": {
  "a": {
   "width": "18",
   "height": "18",
   "fill": "none",
   "stroke": "currentColor",
   "stroke-width": "2",
   "stroke-linecap": "round",
   "stroke-linejoin": "round"
  },
  "k": [
   {
    "d": "M6 8a6 6 0 1 1 12 0c0 3-2 4-3 6s-1 4-3.5 4A3.5 3.5 0 0 1 8 14.5"
   },
   {
    "d": "M10 8a2 2 0 1 1 4 0"
   }
  ]
 }
}
const SVG_NS = 'http://www.w3.org/2000/svg'
/* Built node by node: this page forbids innerHTML and DOMParser (Trusted Types), and an icon is only paths. */
const icon = (name, extra = '') => {
  const span = document.createElement('span')
  span.className = `mu-icon ${extra}`.trim()
  span.setAttribute('aria-hidden', 'true')
  const spec = ICONS[name]
  if (!spec) return span
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  for (const [k, v] of Object.entries(spec.a)) svg.setAttribute(k, v)
  for (const kid of spec.k) {
    const path = document.createElementNS(SVG_NS, 'path')
    for (const [k, v] of Object.entries(kid)) path.setAttribute(k, v)
    svg.append(path)
  }
  span.append(svg)
  return span
}
/** The same colours for the same words, so a song keeps its look wherever it appears. */
const hueOf = (text) => [...String(text || '?')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 11)
const artTile = (track, size = 'm') => {
  const hue = hueOf(`${track?.album || ''}${track?.artist || ''}${track?.title || ''}`)
  const tile = el('span', { class: `mu-art ${size}`, style: `--h:${hue}`, 'aria-hidden': 'true' })
  const picture = track?.id ? art[track.id] : null
  if (picture) {
    tile.classList.add('has-picture')
    tile.append(el('img', { src: picture, alt: '' }))
    return tile
  }
  const letter = (track?.title || '♪').trim().charAt(0).toUpperCase()
  tile.append(el('b', {}, letter))
  return tile
}
const equaliser = () => el('span', { class: 'mu-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'))
const iconButton = (name, label, onclick, extra = {}) => {
  const b = el('button', { type: 'button', class: `mu-btn${extra.class ? ` ${extra.class}` : ''}`, title: label, 'aria-label': label, ...(extra.pressed !== undefined ? { 'aria-pressed': String(extra.pressed) } : {}), onclick })
  b.append(icon(name))
  return b
}

let libTab = 'songs'
let editing = null
const art = {}
const artTried = new Set()
let organisePlan = null
let openList = null
let openTracks = []
let pickFor = null
let dropNote = ''
let dragDepth = 0
let albums = []
let artists = []
let genres = []
let dragging = false

/** Pictures for the tracks now on screen. Asked for once each; a track with none is not asked about again. */
async function loadArt() {
  const seen = [library, recent, openTracks, state?.track ? [state.track] : []].flat()
  const wanted = seen.filter((t) => t && t.id && t.artwork && !(t.id in art) && !artTried.has(t.id)).map((t) => t.id).slice(0, 40)
  if (wanted.length === 0) return false
  for (const id of wanted) artTried.add(id)
  const got = await run('music:do', ['artwork', wanted])
  if (!got || typeof got !== 'object') return false
  Object.assign(art, got)
  return Object.keys(got).length > 0
}

async function refresh() {
  const next = await run('music:state')
  if (next) state = next
  heard = await run('music:heard')
  if (view !== 'playlists') playlists = (await run('music:playlists')) ?? playlists
  if (view === 'library' || view === 'now') library = (await run('music:search', [{ search, sort: 'added' }])) ?? library
  if (view === 'playlists' && openList) openTracks = (await run('music:playlist-tracks', [openList])) ?? []
  if (view === 'library' && libTab === 'albums') albums = (await run('music:albums')) ?? albums
  if (view === 'library' && libTab === 'artists') artists = (await run('music:artists')) ?? artists
  if (view === 'library' && libTab === 'genres') genres = (await run('music:genres')) ?? genres
  if (view === 'playlists') playlists = (await run('music:playlists')) ?? playlists
  if (view === 'recent') recent = (await run('music:recent')) ?? recent
  if (view === 'discover' && explorations.length === 0) explorations = (await ask('explorations')) ?? []
  if (view === 'discover') dna = (await ask('dna')) ?? dna
  if (view === 'bring') await refreshBring()
  if (view === 'settings' && sources.length === 0) sources = (await ask('sources')) ?? []
  if (view === 'now' && state?.track?.id) why = (await ask('why', state.track.id)) ?? null
  draw()
  if (await loadArt()) draw()
}

/** Does something, then reads the state back. Nothing on screen is ever changed hopefully. */
async function act(channel, args, note) {
  busy = note ?? ''
  draw()
  const answer = await run(channel, args)
  busy = ''
  // A refusal is shown as the words it came with: "no audio for this one" is the useful part.
  if (answer && typeof answer === 'object' && answer.ok === false) said = answer.why || 'That could not be done.'
  else if (answer && typeof answer === 'object' && answer.kind) said = keptWords(answer)
  await refresh()
}

/** What happened when a song was kept, in the words of the outcome rather than a cheerful guess. */
const keptWords = (outcome) => {
  switch (outcome.kind) {
    case 'already':
      return 'That song is already in your music.'
    case 'linked':
      return 'Added, using the copy you already have.'
    case 'reference':
      return 'Saved by name. There is no audio for it on this computer; import your own copy to play it here.'
    case 'ask':
      return 'Several of your files might be it. Open your library and pick the right one.'
    default:
      return outcome.why || 'That could not be added.'
  }
}

/**
 * Searching.
 *
 * Two kinds of search arrive at one box. A name is looked up; a description ("calm songs I haven't heard") becomes
 * constraints the engine enforces. Which it was is shown, so nobody has to guess why they got a selection rather
 * than a list of rows.
 *
 * When there is nowhere to look -- which is the normal case, because Orbis has no music catalogue -- that is said
 * with the reason. An empty list would read as "you have no music", which somebody would believe.
 */
function findView() {
  const rows = found ? [...(found.top ? [found.top] : []), ...found.tracks] : []
  return el(
    'section',
    { class: 'music-find' },
    el(
      'form',
      {
        class: 'music-find-form',
        onsubmit: (event) => {
          event.preventDefault()
          void doFind()
        }
      },
      el('input', {
        class: 'music-find-input',
        type: 'search',
        value: search,
        placeholder: 'A song, an artist, or what you feel like',
        'aria-label': 'Search for music',
        oninput: (event) => {
          search = event.target.value
        }
      }),
      el('button', { type: 'submit', class: 'music-btn primary' }, finding ? 'Searching' : 'Search')
    ),

    found?.parsed && found.parsed.described > 0.5
      ? el('p', { class: 'music-note' }, 'Read as a description, so Orbis chose from your music rather than looking up a name.')
      : null,
    found?.parsed?.notUnderstood?.length
      ? el('p', { class: 'music-note' }, `Orbis could not read: ${found.parsed.notUnderstood.join(', ')}`)
      : null,

    found?.empty
      ? el(
          'div',
          { class: 'music-empty' },
          el('p', { class: 'music-empty-title' }, found.empty.title),
          el('p', { class: 'music-note' }, found.empty.detail),
          found.empty.retry ? el('button', { type: 'button', class: 'music-btn', onclick: () => void doFind() }, 'Try again') : null
        )
      : null,

    found?.top
      ? el(
          'div',
          { class: 'music-top' },
          el('p', { class: 'music-kicker' }, 'Top result'),
          foundRow(found.top, true)
        )
      : null,

    rows.length > 0
      ? el('ul', { class: 'music-list' }, ...(found.top ? found.tracks : rows).map((row) => el('li', {}, foundRow(row, false))))
      : null,

    found?.artists?.length
      ? el(
          'div',
          { class: 'music-group' },
          el('p', { class: 'music-kicker' }, 'Artists'),
          el('ul', { class: 'music-chips' }, ...found.artists.slice(0, 12).map((one) => el('li', {}, el('span', { class: 'music-chip' }, one.name))))
        )
      : null,

    found?.albums?.length
      ? el(
          'div',
          { class: 'music-group' },
          el('p', { class: 'music-kicker' }, 'Albums'),
          el(
            'ul',
            { class: 'music-chips' },
            ...found.albums.slice(0, 12).map((one) => el('li', {}, el('span', { class: 'music-chip' }, `${one.title} — ${one.artist}`)))
          )
        )
      : null,

    // Which providers answered, and which could not. Never hidden: it is the reason a search found little.
    found?.asked?.some((one) => !one.ok)
      ? el(
          'p',
          { class: 'music-note' },
          found.asked
            .filter((one) => !one.ok)
            .map((one) => `${one.name}: ${one.reason}`)
            .join(' · ')
        )
      : null
  )
}

/**
 * One row of a search result, with the version written next to the name and its real library state.
 *
 * Named apart from the library's row on purpose. Both were called trackRow, and two function declarations of one name
 * in a module is a SyntaxError -- which does not fail at the line, it fails the whole file, so the music panel never
 * loaded at all. Nothing on screen says which row kind it is; only the browser console ever said anything.
 */
function foundRow(row, big) {
  const canonical = row.canonical
  const version = canonical.version && canonical.version.kind !== 'original' ? versionWords(canonical.version) : ''
  return el(
    'div',
    { class: `music-row${big ? ' big' : ''}${row.playable ? '' : ' unplayable'}` },
    el(
      'div',
      { class: 'music-row-main' },
      el('p', { class: 'music-row-title' }, canonical.name, version ? el('span', { class: 'music-version' }, version) : null),
      el('p', { class: 'music-row-sub' }, [canonical.artist, canonical.album, length(canonical.duration)].filter(Boolean).join(' · '))
    ),
    el(
      'div',
      { class: 'music-row-right' },
      // The state as it actually is: already here, playable, or neither.
      row.inLibrary ? el('span', { class: 'music-state good' }, 'In your music') : null,
      !row.playable ? el('span', { class: 'music-state warn' }, 'No audio here') : null,
      row.playable && row.libraryId
        ? el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:play', [row.libraryId], 'Playing…') }, 'Play')
        : null
    )
  )
}

/** How a version is written next to a title. */
const versionWords = (version) => {
  if (version.kind === 'remix' && version.by) return `${version.by} remix`
  const words = {
    remaster: 'Remastered',
    live: 'Live',
    acoustic: 'Acoustic',
    'radio-edit': 'Radio edit',
    extended: 'Extended',
    remix: 'Remix',
    instrumental: 'Instrumental',
    clean: 'Clean',
    explicit: 'Explicit',
    'sped-up': 'Sped up',
    slowed: 'Slowed',
    demo: 'Demo',
    alternate: 'Alternate'
  }
  return words[version.kind] ?? ''
}

async function doFind() {
  if (!search.trim()) return
  finding = true
  draw()
  found = await ask('find', search.trim(), 40)
  finding = false
  draw()
}

/**
 * Discover: the named ways of exploring, and what Orbis has worked out about this listener.
 *
 * Every tile is a real set of constraints handed to the engine, not a label on a shuffle. The numbers underneath
 * are measured from what was actually played -- with how sure Orbis is next to them, because a number from nine
 * plays is not the same as a number from nine hundred.
 */
function discoverView() {
  return el(
    'section',
    { class: 'music-discover' },
    el(
      'ul',
      { class: 'music-tiles' },
      ...explorations.map((one) =>
        el(
          'li',
          {},
          el(
            'button',
            {
              type: 'button',
              class: 'music-tile',
              onclick: async () => {
                const outcome = await ask('explore', one.id)
                said = outcome && outcome.ok === false ? outcome.why : outcome?.because || `Playing: ${one.label}`
                await refresh()
              }
            },
            el('strong', {}, one.label),
            el('span', {}, one.blurb)
          )
        )
      )
    ),
    dna
      ? el(
          'div',
          { class: 'music-dna' },
          el('p', { class: 'music-kicker' }, 'What Orbis has worked out'),
          dna.confidence !== undefined
            ? el('p', { class: 'music-note' }, `From ${dna.plays ?? 0} plays. ${dna.confidence < 0.3 ? 'Still early, so treat these loosely.' : ''}`)
            : null,
          el(
            'ul',
            { class: 'music-dna-list' },
            ...Object.entries(dna.dimensions ?? {})
              .slice(0, 8)
              .map(([name, value]) =>
                el(
                  'li',
                  {},
                  el('span', {}, name),
                  el('span', { class: 'music-bar' }, el('span', { style: `width:${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%` })),
                  el('span', { class: 'music-dna-value' }, String(Math.round((Number(value) || 0) * 100)))
                )
              )
          )
        )
      : el('p', { class: 'music-note' }, 'Play a few things and Orbis will have something to show here.')
  )
}

// ---------------------------------------------------------------- the parts of the screen

/** The player: artwork, the track, the controls, and whose sound it is. */
function nowPlaying() {
  const playback = state?.playback
  const track = state?.track
  const owner = playback?.owner ?? 'none'

  if (owner === 'website') {
    const names = heard?.recognition?.names
    return el(
      'section',
      { class: 'mu-hero website' },
      el('span', { class: 'mu-chip' }, 'Playing on a web page'),
      el('div', { class: 'mu-hero-art' }, artTile(names ? { title: names.title, artist: names.artist } : { title: '♪' }, 'xl')),
      el('p', { class: 'music-title' }, names ? `${names.title}${names.artist ? ` — ${names.artist}` : ''}` : 'Something on this page'),
      el('p', { class: 'music-note' }, 'That player belongs to the page. Orbis leaves it alone, and can add the song to your music.'),
      addButton()
    )
  }

  if (!track) return welcome()

  const total = Math.max(1, Math.round(playback.duration || track.duration || 1))
  const position = Math.min(total, Math.round(playback.position || 0))
  const bar = el('input', {
    type: 'range',
    class: 'mu-seek',
    min: '0',
    max: String(total),
    value: String(position),
    style: `--p:${Math.round((position / total) * 100)}%`,
    'aria-label': 'Where you are in the track',
    oninput: (event) => void act('music:seek', [Number(event.target.value)])
  })

  return el(
    'section',
    { class: `mu-hero${playback.playing ? ' playing' : ''}` },
    el('span', { class: 'mu-chip' }, playback.playing ? 'Playing from Orbis Music' : 'Paused'),
    el('div', { class: 'mu-hero-art' }, artTile(track, 'xl'), playback.playing ? equaliser() : null),
    el('div', { class: 'mu-hero-text' }, el('p', { class: 'music-title' }, track.title), el('p', { class: 'music-artist' }, [track.artist, track.album].filter(Boolean).join(' — ') || 'Unknown artist')),
    el('div', { class: 'mu-times' }, el('span', {}, length(playback.position)), bar, el('span', {}, length(playback.duration || track.duration))),
    el(
      'div',
      { class: 'mu-transport' },
      iconButton('shuffle', 'Shuffle', () => void act('music:shuffle', [!playback.shuffle]), { pressed: Boolean(playback.shuffle) }),
      iconButton('prev', 'Previous', () => void act('music:previous')),
      iconButton(playback.playing ? 'pause' : 'play', playback.playing ? 'Pause' : 'Play', () => void act(playback.playing ? 'music:pause' : 'music:resume'), { class: 'big' }),
      iconButton('next', 'Next', () => void act('music:next')),
      iconButton('repeat', playback.repeat === 'one' ? 'Repeat this track' : playback.repeat === 'all' ? 'Repeat all' : 'Repeat off', () => void act('music:repeat', [playback.repeat === 'off' ? 'all' : playback.repeat === 'all' ? 'one' : 'off']), {
        pressed: playback.repeat !== 'off',
        class: playback.repeat === 'one' ? 'one' : ''
      })
    ),
    el(
      'div',
      { class: 'mu-secondary' },
      iconButton('heart', track.favourite ? 'Remove from favourites' : 'Add to favourites', () => void act('music:favourite', [track.id, !track.favourite]), { pressed: Boolean(track.favourite), class: 'heart' }),
      iconButton('edit', 'Edit details and artwork', () => { editing = { ...track }; draw() }),
      el('div', { class: 'mu-vol' }, iconButton(playback.muted ? 'mute' : 'volume', playback.muted ? 'Unmute' : 'Mute', () => void act('music:mute', [!playback.muted])),
        el('input', {
          type: 'range', min: '0', max: '100', class: 'mu-slider', value: String(Math.round((playback.volume ?? 1) * 100)),
          style: `--p:${Math.round((playback.volume ?? 1) * 100)}%`, 'aria-label': 'Volume',
          oninput: (event) => void act('music:volume', [Number(event.target.value) / 100])
        })
      )
    ),
    playback.problem ? el('p', { class: 'music-problem' }, playback.problem) : null
  )
}

/** What a person sees before anything is playing: what this is, and the three ways to start. */
function welcome() {
  const have = library.length
  return el(
    'section',
    { class: 'mu-welcome' },
    el('div', { class: 'mu-orb', 'aria-hidden': 'true' }, icon('note')),
    el('h2', {}, have ? 'Pick something to play' : 'Your music, inside Orbis'),
    el('p', { class: 'music-note' }, have
      ? `${have} ${have === 1 ? 'song is' : 'songs are'} ready in your library.`
      : 'Orbis Music plays songs you own, keeps them in one library, and can name what is playing on a web page. Nothing is downloaded from a website.'),
    have
      ? el('div', { class: 'mu-actions' }, el('button', { type: 'button', class: 'mu-cta', onclick: () => void act('music:play-all', [library.map((t) => t.id), 0]) }, 'Play everything'), el('button', { type: 'button', class: 'mu-ghost', onclick: () => { view = 'library'; void refresh() } }, 'Open the library'))
      : el(
          'div',
          { class: 'mu-steps' },
          el('button', { type: 'button', class: 'mu-step', onclick: () => void act('music:import', [], 'Choose files in the Orbis window…') }, icon('file'), el('span', {}, el('b', {}, 'Add songs'), el('small', {}, 'Pick audio files, or just drop them anywhere here'))),
          el('button', { type: 'button', class: 'mu-step', onclick: () => void act('music:scan-folder', [], 'Choose a folder in the Orbis window…') }, icon('folder'), el('span', {}, el('b', {}, 'Add a folder'), el('small', {}, 'Bring in a whole music folder at once'))),
          el('button', { type: 'button', class: 'mu-step', onclick: () => void act('music:listen', [], 'Listening to the page…') }, icon('ear'), el('span', {}, el('b', {}, 'Name what is playing'), el('small', {}, 'Recognise a song from the page in front of you')))
        )
  )
}

/** The button for a song recognised on a page. Only ever shown when Orbis actually knows what it is. */
function addButton() {
  if (!heard?.sighting) return null
  if (heard.working) return el('p', { class: 'music-note' }, 'Working out what this is…')
  const names = heard.recognition?.names
  if (!names) {
    return el(
      'div',
      { class: 'music-add' },
      el('p', { class: 'music-note' }, heard.recognition?.why || 'Orbis could not work out what this is.'),
      el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:listen', [], 'Looking at the page…') }, 'Try again')
    )
  }
  if (heard.inLibraryId) {
    return el(
      'div',
      { class: 'music-add' },
      el('p', { class: 'music-note' }, `${names.title} is already in your music.`),
      el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:play', [heard.inLibraryId]) }, 'Play your copy')
    )
  }
  const sure = heard.recognition?.confidence
  return el(
    'div',
    { class: 'music-add' },
    el('p', { class: 'music-heard' }, `${names.title}${names.artist ? ` — ${names.artist}` : ''}`),
    // How sure Orbis is, said out loud: a guess read off a screen is not the same as a name the page published.
    sure === 'low' ? el('p', { class: 'music-note' }, 'Orbis is not certain about this one.') : null,
    el(
      'button',
      { type: 'button', class: 'music-btn primary', onclick: () => void act('music:keep-heard', [names, heard.sighting.duration ?? 0, { provider: heard.sighting.provider, url: heard.sighting.url }], 'Adding…') },
      'Add to Orbis Music'
    )
  )
}

/** One row of the library. */
function trackRow(track, index, queue) {
  const where = availability(track)
  const current = state?.playback?.trackId === track.id
  const playing = current && state?.playback?.playing
  return el(
    'li',
    { class: `mu-row${current ? ' current' : ''}${where.tone === 'good' ? '' : ' unavailable'}` },
    el(
      'button',
      {
        type: 'button',
        class: 'mu-row-main',
        title: where.tone === 'good' ? `Play ${track.title}` : where.label,
        onclick: () => void act('music:play', [track.id])
      },
      el('span', { class: 'mu-art-wrap' }, artTile(track, 's'), playing ? equaliser() : null),
      el('span', { class: 'mu-row-text' }, el('span', { class: 'music-row-title' }, track.title), el('span', { class: 'music-row-artist' }, [track.artist, track.album].filter(Boolean).join(' — ') || 'Unknown artist'))
    ),
    where.tone === 'good' ? null : el('span', { class: `mu-where ${where.tone}` }, where.label),
    el('span', { class: 'music-row-length' }, length(track.duration)),
    iconButton('heart', track.favourite ? 'Remove from favourites' : 'Add to favourites', () => void act('music:favourite', [track.id, !track.favourite]), { pressed: Boolean(track.favourite), class: 'heart small' }),
    el('button', { type: 'button', class: 'mu-btn small', title: 'Edit details and artwork', 'aria-label': 'Edit details and artwork', onclick: () => { editing = { ...track }; draw() } }, icon('edit')),
    el('button', { type: 'button', class: 'mu-btn small', title: 'Add to a playlist', 'aria-label': 'Add to a playlist', onclick: () => { pickFor = track.id; draw() } }, icon('list')),
    typeof index === 'number'
      ? iconButton('plus', 'Take out of the queue', () => void act('music:queue-remove', [index]), { class: 'small remove' })
      : iconButton('plus', 'Add to the queue', () => void act('music:queue-end', [[track.id]]), { class: 'small' })
  )
}

function libraryView() {
  const box = el('input', {
    type: 'search',
    class: 'mu-search',
    placeholder: 'Search your music',
    value: search,
    'aria-label': 'Search your music',
    oninput: (event) => {
      search = event.target.value
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), 200)
    }
  })
  /*
   * Adding your own music.
   *
   * The file picker belongs to the Orbis window, which is where the files are read. The panel never names a path and
   * never learns one: what comes back is how many files were added.
   */
  const bringIn = el(
    'div',
    { class: 'mu-addbar' },
    el('button', { type: 'button', class: 'mu-cta small', onclick: () => void act('music:import', [], 'Choose files in the Orbis window…') }, icon('file'), 'Add files'),
    el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void act('music:scan-folder', [], 'Choose a folder in the Orbis window…') }, icon('folder'), 'Add a folder'),
    library.length ? el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void act('music:play-all', [library.map((t) => t.id), 0]) }, icon('play'), 'Play all') : null
  )
  const tabs = el(
    'div',
    { class: 'mu-subtabs', role: 'tablist' },
    ...[['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['genres', 'Genres']].map(([id, label]) =>
      el('button', { type: 'button', role: 'tab', class: `mu-subtab${libTab === id ? ' on' : ''}`, 'aria-selected': String(libTab === id), onclick: () => { libTab = id; void refresh() } }, label)
    )
  )
  const head = [box, bringIn, tabs]

  const group = (list, kind) =>
    el(
      'div',
      { class: 'mu-groups' },
      ...list.map((g) =>
        el(
          'button',
          { type: 'button', class: 'mu-group', onclick: () => void act('music:play-all', [g.tracks.map((t) => t.id), 0]), title: `Play ${g.name}` },
          artTile({ title: g.name, artist: g.by ?? '' }, 'l'),
          el('span', { class: 'mu-group-name' }, g.name),
          el('span', { class: 'mu-group-sub' }, [kind === 'albums' ? g.by : '', `${g.tracks.length} ${g.tracks.length === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · '))
        )
      )
    )

  if (libTab === 'albums') return el('section', { class: 'mu-library' }, ...head, albums.length ? group(albums, 'albums') : el('p', { class: 'music-note' }, 'No albums yet. They appear as soon as songs with album tags are added.'))
  if (libTab === 'artists') return el('section', { class: 'mu-library' }, ...head, artists.length ? group(artists, 'artists') : el('p', { class: 'music-note' }, 'No artists yet.'))
  if (libTab === 'genres') return el('section', { class: 'mu-library' }, ...head, genres.length ? group(genres, 'genres') : el('p', { class: 'music-note' }, 'No genres yet. Songs show up here when their files name one.'))

  if (library.length === 0) {
    return el('section', { class: 'mu-library' }, ...head, search ? el('p', { class: 'music-note' }, `Nothing in your music matches "${search}".`) : welcome())
  }
  return el('section', { class: 'mu-library' }, ...head, el('ul', { class: 'mu-rows' }, ...library.map((track) => trackRow(track))))
}

function queueView() {
  const queue = state?.queue ?? []
  if (queue.length === 0) return el('section', { class: 'mu-library' }, el('div', { class: 'mu-welcome small' }, el('h2', {}, 'The queue is empty'), el('p', { class: 'music-note' }, 'Press + beside a song to line it up next, or play a whole album from the library.')))
  return el(
    'section',
    { class: 'music-list' },
    el('div', { class: 'music-list-head' }, el('span', {}, `${queue.length} in the queue`), el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:queue-clear') }, 'Clear')),
    el('ul', { class: 'mu-rows' }, ...queue.map((track, index) => trackRow(track, index, true)))
  )
}

function playlistsView() {
  const make = el(
    'form',
    {
      class: 'music-make',
      onsubmit: (event) => {
        event.preventDefault()
        const name = event.target.elements.name.value.trim()
        if (!name) return
        event.target.reset()
        void act('music:create-playlist', [name])
      }
    },
    el('input', { name: 'name', type: 'text', placeholder: 'New playlist', 'aria-label': 'New playlist name', maxlength: '200' }),
    el('button', { type: 'submit', class: 'mu-cta small' }, 'Create')
  )

  // ---- smart playlists: ready-made questions, and one the person can word themselves
  const smart = (name, rule) => act('music:do', ['smart-playlist', name, rule], `Making "${name}"…`)
  const presets = [
    ['Recently added', { addedWithinDays: 30, order: 'added', limit: 100 }],
    ['Most played', { order: 'plays', limit: 50 }],
    ['Played this week', { playedWithinDays: 7, order: 'recent', limit: 100 }],
    ['Favourites', { favourite: true }],
    ['Ready offline', { availableOffline: true, order: 'title' }]
  ]
  const builder = el(
    'form',
    {
      class: 'mu-smart-form',
      onsubmit: (event) => {
        event.preventDefault()
        const f = event.target.elements
        const n = (value) => (value.trim() === '' ? undefined : Number(value))
        const rule = {
          artist: f.artist.value.trim() || undefined,
          genre: f.genre.value.trim() || undefined,
          yearFrom: n(f.yearFrom.value),
          yearTo: n(f.yearTo.value),
          favourite: f.favourite.checked || undefined,
          order: f.order.value || undefined,
          limit: n(f.limit.value)
        }
        const name = f.name.value.trim() || [rule.artist, rule.genre, rule.favourite ? 'Favourites' : ''].filter(Boolean).join(' · ') || 'Smart playlist'
        event.target.reset()
        void smart(name, rule)
      }
    },
    el('input', { name: 'name', type: 'text', placeholder: 'Name (optional)', maxlength: '80', 'aria-label': 'Smart playlist name' }),
    el('input', { name: 'artist', type: 'text', placeholder: 'Artist is…', 'aria-label': 'Artist' }),
    el('input', { name: 'genre', type: 'text', placeholder: 'Genre is…', 'aria-label': 'Genre' }),
    el('div', { class: 'mu-smart-years' }, el('input', { name: 'yearFrom', type: 'number', placeholder: 'Year from', 'aria-label': 'Year from' }), el('input', { name: 'yearTo', type: 'number', placeholder: 'Year to', 'aria-label': 'Year to' })),
    el(
      'select',
      { name: 'order', 'aria-label': 'Order' },
      el('option', { value: '' }, 'Any order'),
      el('option', { value: 'plays' }, 'Most played first'),
      el('option', { value: 'recent' }, 'Played most recently'),
      el('option', { value: 'added' }, 'Newest added'),
      el('option', { value: 'title' }, 'By title')
    ),
    el('input', { name: 'limit', type: 'number', min: '1', max: '500', placeholder: 'At most… songs', 'aria-label': 'At most how many songs' }),
    el('label', { class: 'mu-check' }, el('input', { name: 'favourite', type: 'checkbox' }), 'Only favourites'),
    el('button', { type: 'submit', class: 'mu-cta small' }, 'Make smart playlist')
  )
  const smartBox = el(
    'section',
    { class: 'mu-smart' },
    el('h3', {}, 'Smart playlists'),
    el('p', { class: 'music-note' }, 'These answer a question about your library and stay up to date as it changes.'),
    el('div', { class: 'mu-presets' }, ...presets.map(([name, rule]) => el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void smart(name, rule) }, name))),
    el('details', { class: 'mu-smart-more' }, el('summary', {}, 'Make your own'), builder)
  )

  // ---- one open playlist
  if (openList) {
    const list = playlists.find((one) => one.id === openList)
    if (!list) {
      openList = null
    } else {
      return el(
        'section',
        { class: 'mu-library' },
        el('div', { class: 'mu-addbar' },
          el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { openList = null; void refresh() } }, 'Back'),
          el('button', { type: 'button', class: 'mu-cta small', onclick: () => void act('music:play-playlist', [list.id]) }, icon('play'), `Play ${list.name}`),
          el('button', { type: 'button', class: 'mu-ghost small', onclick: async () => { const out = await run('music:do', ['export-m3u', list.id]); if (out && out.ok) { saveText(out.name, out.text, 'audio/x-mpegurl'); said = `Saved ${out.name}.` } else said = out?.why || 'That could not be exported.'; draw() } }, 'Export .m3u')
        ),
        el('p', { class: 'music-note' }, list.rule ? 'A smart playlist: it is worked out from your library each time.' : `${openTracks.length} ${openTracks.length === 1 ? 'song' : 'songs'}`),
        openTracks.length === 0
          ? el('p', { class: 'music-note' }, list.rule ? 'Nothing in your library matches this yet.' : 'Empty. Use the list button beside any song to add it here.')
          : el('ul', { class: 'mu-rows' }, ...openTracks.map((track) => {
              const row = trackRow(track)
              if (!list.rule) row.append(el('button', { type: 'button', class: 'mu-btn small', title: 'Take out of this playlist', 'aria-label': 'Take out of this playlist', onclick: () => void act('music:remove-from-playlist', [list.id, track.id]) }, '×'))
              return row
            })),
        el('div', { class: 'mu-addbar' },
          el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { const name = window.prompt('Rename playlist', list.name); if (name && name.trim()) void act('music:do', ['rename-playlist', list.id, name.trim()]) } }, 'Rename'),
          el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { if (window.confirm(`Delete "${list.name}"? The songs stay in your library.`)) { openList = null; void act('music:do', ['remove-playlist', list.id]) } } }, 'Delete')
        )
      )
    }
  }

  const rows = playlists.length === 0
    ? el('p', { class: 'music-note' }, 'No playlists yet. Make one above, or start from a smart playlist.')
    : el('ul', { class: 'music-rows' }, ...playlists.map((list) =>
        el('li', { class: 'music-bring-row' },
          el('button', { type: 'button', class: 'music-row-play', onclick: () => { openList = list.id; void refresh() } },
            artTile({ title: list.name }, 's'),
            el('span', { class: 'mu-row-text' },
              el('span', { class: 'music-row-title' }, list.name),
              el('span', { class: 'music-row-artist' }, list.rule ? 'Smart playlist' : `${list.tracks.length} ${list.tracks.length === 1 ? 'song' : 'songs'}`)
            )
          ),
          iconButton('play', `Play ${list.name}`, () => void act('music:play-playlist', [list.id]), { class: 'small primary' })
        )
      ))
  return el('section', { class: 'mu-library' }, make, rows, smartBox)
}

function recentView() {
  if (recent.length === 0) return el('section', { class: 'music-list' }, el('p', { class: 'music-note' }, 'Nothing has been played through Orbis Music yet.'))
  return el('section', { class: 'mu-library' }, el('ul', { class: 'mu-rows' }, ...recent.map((track) => trackRow(track))))
}

/**
 * How Music behaves. Everything here is the music store's own setting, read back after every change.
 *
 * Nothing here switches on anything that costs somebody something without saying so: looking at the screen to work
 * out a song is named as that, and starting playback by itself is off unless it is asked for.
 */
function settingsView() {
  const settings = state?.settings
  if (!settings) return el('section', { class: 'music-list' }, el('p', { class: 'music-note' }, 'Orbis is not running, so there are no settings to show.'))

  const choice = (label, value, options) =>
    el(
      'label',
      { class: 'music-field' },
      el('span', {}, label),
      el(
        'select',
        {
          onchange: (event) => void act('music:save-settings', [{ [value]: event.target.value }])
        },
        ...options.map(([id, text]) => el('option', { value: id, selected: settings[value] === id }, text))
      )
    )

  const switchFor = (label, key, note) =>
    el(
      'label',
      { class: 'music-field' },
      el('input', {
        type: 'checkbox',
        checked: settings[key] === true,
        onchange: (event) => void act('music:save-settings', [{ [key]: event.target.checked }])
      }),
      el('span', {}, label),
      note ? el('span', { class: 'music-note' }, note) : null
    )

  return el(
    'section',
    { class: 'music-list' },
    choice('Work out what is playing', 'recognition', [
      ['automatic', 'While I browse'],
      ['manual', 'Only when I ask'],
      ['off', 'Never']
    ]),
    switchFor('Read the player on screen when a page does not say', 'useVision', 'Orbis looks at the tab it is playing in, asks once, and keeps nothing.'),
    switchFor('Carry on from where a track was left', 'resume'),
    switchFor('Start playing when Orbis opens', 'playOnStart', 'Off unless you ask for it.'),
    settings.folders?.length
      ? el('p', { class: 'music-note' }, `Watching ${settings.folders.length} ${settings.folders.length === 1 ? 'folder' : 'folders'} for music. Add one from the Orbis window.`)
      : el('p', { class: 'music-note' }, 'Import music, or choose a folder to watch, from the Orbis window.')
  )
}
/**
 * Bringing music in from somewhere else.
 *
 * ## Three screens in order, and the order is the honesty
 *
 * Choose where it comes from, see what would change, then say yes. Nothing is written between the first two, so
 * the middle screen is a real preview and not a progress bar for something that already happened. The button that
 * commits is the only one here that changes a playlist, and it says how many tracks and into which playlist.
 *
 * ## A card never says Connected because the service exists
 *
 * Every service needing an application registered with it says exactly that, in its own words, on its own card.
 * The three routes needing no account sit at the top, because on a fresh install they are the ones that work.
 *
 * ## Tracks that were not found are shown, not swallowed
 *
 * The preview counts them and the unmatched list keeps them. A playlist that imported 380 of 400 and said nothing
 * about the other 20 is how somebody loses twenty tracks without ever knowing.
 */

/** State for the three screens. Held in one place so nothing half-done is mistaken for a finished import. */
const bringing = { step: 'choose', sources: null, jobs: [], unmatched: [], prepared: null, jobId: null, mapping: null, pasting: false }

function bringInView() {
  if (bringing.step === 'preview' && bringing.prepared) return previewView()

  const connections = bringing.sources?.connections ?? []
  const easy = connections.filter((one) => one.needs === '')
  const services = connections.filter((one) => one.needs !== '')

  return el(
    'section',
    { class: 'music-bring' },
    el(
      'p',
      { class: 'music-note' },
      'Your playlists from somewhere else, matched against the music you already have. Nothing changes until you have seen what would.'
    ),

    el('h4', {}, 'Needs no account'),
    el(
      'div',
      { class: 'music-cards' },
      ...easy.map((one) =>
        el(
          'div',
          { class: 'music-card' },
          el('strong', {}, one.name),
          el(
            'button',
            {
              type: 'button',
              class: 'music-btn primary',
              onclick: () => {
                if (one.kind === 'paste') {
                  bringing.pasting = true
                  draw()
                  return
                }
                void readFromFiles()
              }
            },
            one.kind === 'paste' ? 'Paste a list' : one.kind === 'folder' ? 'Choose a folder' : 'Choose a file'
          )
        )
      )
    ),

    bringing.pasting
      ? el(
          'div',
          { class: 'music-paste' },
          el(
            'label',
            { class: 'music-field' },
            el('span', {}, 'What to call it'),
            el('input', { id: 'paste-name', value: 'Pasted list', maxlength: '200' })
          ),
          el('textarea', { id: 'paste-text', rows: '8', placeholder: 'One track a line, usually Artist - Title', 'aria-label': 'The list' }),
          el(
            'div',
            { class: 'music-bring-row' },
            el(
              'button',
              {
                type: 'button',
                class: 'music-btn primary',
                onclick: () => {
                  const name = document.getElementById('paste-name')?.value ?? ''
                  const text = document.getElementById('paste-text')?.value ?? ''
                  bringing.pasting = false
                  void readPasted(name, text)
                }
              },
              'Read it'
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'music-btn',
                onclick: () => {
                  bringing.pasting = false
                  draw()
                }
              },
              'Cancel'
            )
          )
        )
      : null,

    el('h4', {}, 'Music services'),
    el(
      'div',
      { class: 'music-cards' },
      ...services.map((one) =>
        el(
          'div',
          { class: 'music-card' },
          el('strong', {}, one.name),
          // The state in its own words. Never "Connected" unless the connection itself says so.
          el('span', { class: 'music-state' }, stateLabel(one)),
          one.state === 'not-set-up' ? el('p', { class: 'music-note small' }, one.needs) : null,
          one.state === 'connected'
            ? el(
                'button',
                { type: 'button', class: 'music-btn', onclick: () => void act('music:do', ['migration-disconnect', one.sourceId], 'Signing out…') },
                'Sign out'
              )
            : el(
                'button',
                {
                  type: 'button',
                  class: 'music-btn',
                  disabled: one.state === 'not-set-up' ? true : null,
                  onclick: () => void connectTo(one.sourceId)
                },
                'Connect'
              )
        )
      )
    ),
    bringing.sources && bringing.sources.canKeepTokens === false
      ? el('p', { class: 'music-note' }, 'This computer cannot store a sign-in securely, so Orbis will not keep one. Files and folders still work.')
      : null,

    bringing.jobs.length > 0
      ? el(
          'div',
          { class: 'music-history' },
          el('h4', {}, 'What you have brought in'),
          el(
            'ul',
            { class: 'music-list' },
            ...bringing.jobs.slice(0, 12).map((one) =>
              el(
                'li',
                {},
                el('span', {}, one.says),
                // Only ever offered when the job really does have something left to do.
                one.resumable ? el('button', { type: 'button', class: 'music-btn small', onclick: () => void resumeJob(one.id) }, 'Carry on') : null
              )
            )
          )
        )
      : null,

    bringing.unmatched.length > 0
      ? el(
          'div',
          { class: 'music-unmatched' },
          el('h4', {}, `Not found in your library (${bringing.unmatched.length})`),
          el(
            'ul',
            { class: 'music-list' },
            ...bringing.unmatched.slice(0, 20).map((row) =>
              el(
                'li',
                {},
                el('span', {}, row.wanted.artist ? `${row.wanted.title} — ${row.wanted.artist}` : row.wanted.title),
                el('span', { class: 'music-note small' }, row.why),
                ...row.candidates.slice(0, 3).map((two) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'music-btn small',
                      onclick: () => void act('music:do', ['migration-match-by-hand', row.id, two.trackId], 'Saving that…')
                    },
                    `It is ${two.title}`
                  )
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'music-btn small quiet',
                    onclick: () => void act('music:do', ['migration-not-wanted', row.id], 'Leaving it out…')
                  },
                  'Do not want it'
                )
              )
            )
          )
        )
      : null
  )
}

/** What a connection card says. Derived from the state, never from whether the service exists. */
function stateLabel(one) {
  switch (one.state) {
    case 'connected':
      return one.account ? `Connected as ${one.account}` : 'Connected'
    case 'not-set-up':
      return 'Not set up'
    case 'expired':
      return 'Needs signing in again'
    case 'refused':
      return 'Permission refused'
    case 'broken':
      return 'Could not reach it'
    case 'connecting':
      return 'Connecting'
    default:
      return 'Not connected'
  }
}

/** The preview. Every number on it was worked out against the real library. */
function previewView() {
  const prepared = bringing.prepared
  const rows = prepared.playlists ?? []
  const adding = rows.reduce((sum, row) => sum + (row.plan?.added?.length ?? 0), 0)
  return el(
    'section',
    { class: 'music-bring' },
    el('h4', {}, `From ${prepared.sourceName}`),
    el('p', { class: 'music-note' }, prepared.says),
    el(
      'ul',
      { class: 'music-list' },
      ...rows.map((row) =>
        el(
          'li',
          { class: 'music-plan' },
          el('strong', {}, row.name),
          el(
            'span',
            { class: 'music-note small' },
            row.destinationId ? `Into your "${row.destinationName}"` : `Makes a new playlist called "${row.destinationName}"`
          ),
          // The plan's own sentence, which is where it says whether anything of theirs would go.
          el('span', { class: row.plan?.destructive ? 'music-warn' : 'music-note small' }, row.plan ? row.plan.says : 'Nothing to add from this one.'),
          row.ambiguous > 0 ? el('span', { class: 'music-note small' }, `${row.ambiguous} need a look — they are kept in the list below.`) : null,
          row.unmatched > 0 ? el('span', { class: 'music-note small' }, `${row.unmatched} are not in your library.`) : null,
          el(
            'label',
            { class: 'music-field' },
            el('span', {}, 'Put it in'),
            el(
              'select',
              {
                onchange: (event) => {
                  bringing.mapping = { ...(bringing.mapping ?? {}), [row.sourceId]: event.target.value || null }
                  void reprepare()
                }
              },
              el('option', { value: '' }, 'A new playlist'),
              ...(playlists ?? []).map((one) =>
                el('option', { value: one.id, selected: row.destinationId === one.id ? true : null }, one.name)
              )
            )
          ),
          el('span', { class: 'music-note small' }, `${row.plan?.added?.length ?? 0} would be added`)
        )
      )
    ),
    el(
      'div',
      { class: 'music-bring-row' },
      el(
        'button',
        { type: 'button', class: 'music-btn primary', disabled: adding === 0 ? true : null, onclick: () => void applyPlan() },
        adding === 1 ? 'Add 1 track' : `Add ${adding} tracks`
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'music-btn',
          onclick: () => {
            bringing.step = 'choose'
            bringing.prepared = null
            bringing.mapping = null
            void refreshBring()
          }
        },
        'Cancel'
      )
    )
  )
}

async function refreshBring() {
  bringing.sources = (await ask('migration-sources')) ?? bringing.sources
  bringing.jobs = (await ask('migration-jobs')) ?? []
  bringing.unmatched = (await ask('migration-unmatched')) ?? []
  playlists = (await run('music:playlists')) ?? playlists
}

async function readFromFiles() {
  busy = 'Reading…'
  draw()
  const out = await ask('migration-read-files')
  busy = ''
  if (!out || !out.jobId) {
    said = out?.says ?? 'No file was chosen.'
    draw()
    return
  }
  bringing.jobId = out.jobId
  // Any file that could not be read is said now, next to the ones that could.
  const bad = (out.read ?? []).filter((one) => one.why)
  said = bad.length > 0 ? bad.map((one) => `${one.name}: ${one.why}`).join(' · ') : ''
  await prepareBring()
}

async function readPasted(name, text) {
  if (!text.trim()) {
    said = 'Nothing was pasted in.'
    draw()
    return
  }
  busy = 'Reading…'
  draw()
  const out = await ask('migration-read-paste', name, text)
  busy = ''
  if (!out || !out.jobId) {
    said = out?.says ?? 'Nothing readable in that.'
    draw()
    return
  }
  bringing.jobId = out.jobId
  await prepareBring()
}

/** Reads, matches and plans. Writes nothing, which is the whole point of it being its own step. */
async function prepareBring() {
  busy = 'Working out what would change…'
  draw()
  const prepared = await ask('migration-prepare', bringing.jobId, bringing.mapping ?? undefined)
  busy = ''
  if (!prepared || (prepared.playlists ?? []).length === 0) {
    said = prepared?.says ?? 'There was nothing in that to bring in.'
    draw()
    return
  }
  bringing.prepared = prepared
  bringing.step = 'preview'
  playlists = (await run('music:playlists')) ?? playlists
  draw()
}

/** Re-plans after a destination changes. Still writes nothing. */
async function reprepare() {
  const prepared = await ask('migration-prepare', bringing.jobId, bringing.mapping ?? undefined)
  if (prepared) bringing.prepared = prepared
  draw()
}

async function applyPlan() {
  const rows = (bringing.prepared?.playlists ?? [])
    .filter((row) => (row.plan?.added?.length ?? 0) > 0)
    .map((row) => ({
      sourceId: row.sourceId,
      destinationId: row.destinationId,
      destinationName: row.destinationName,
      // The whole resulting order, so a merge that reorders is applied exactly as the preview showed it.
      trackIds: (row.plan?.result ?? []).map((one) => one.id)
    }))
  if (rows.length === 0) {
    said = 'There is nothing to add.'
    draw()
    return
  }
  busy = 'Adding them…'
  draw()
  const out = await ask('migration-apply', bringing.jobId, rows)
  busy = ''
  // The sentence comes from the job, which counted the playlist afterwards — not from what was asked for.
  said = out?.says ?? 'That did not work.'
  bringing.step = 'choose'
  bringing.prepared = null
  bringing.mapping = null
  await refreshBring()
  draw()
}

async function connectTo(sourceId) {
  const out = await ask('migration-connect', sourceId)
  said = out?.ok ? out.says : (out?.why ?? 'That did not work.')
  draw()
}

async function resumeJob(jobId) {
  bringing.jobId = jobId
  await prepareBring()
}

const TABS = [
  { id: 'now', label: 'Now playing' },
  { id: 'library', label: 'Library' },
  { id: 'queue', label: 'Queue' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'find', label: 'Find' },
  { id: 'discover', label: 'Discover' },
  { id: 'recent', label: 'Recent' },
  { id: 'bring', label: 'Bring in' },
  { id: 'manage', label: 'Export & tidy' },
  { id: 'settings', label: 'Settings' }
]



/* ---- editing one track: names and picture ---------------------------------------------------------------------------- */
const MAX_PICTURE = 4 * 1024 * 1024

async function pictureFromFile(file) {
  if (!file) return
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    said = 'Choose a PNG, JPEG, WebP or GIF picture.'
    draw()
    return
  }
  if (file.size > MAX_PICTURE) {
    said = 'That picture is larger than 4 MB. Choose a smaller one.'
    draw()
    return
  }
  const data = toBase64(await file.arrayBuffer())
  const answer = await run('music:do', ['set-artwork', editing.id, { data }])
  if (!answer || answer.ok === false) said = answer?.why || problem || 'That picture could not be used.'
  else {
    said = `Artwork changed${answer.width ? ` (${answer.width}×${answer.height})` : ''}.`
    delete art[editing.id]
    artTried.delete(editing.id)
    editing = { ...editing, artwork: answer.artwork }
  }
  await refresh()
}

function editorView() {
  const t = editing
  const field = (name, label, value, attrs = {}) =>
    el('label', { class: 'mu-field' }, el('span', {}, label), el('input', { name, type: attrs.type || 'text', value: value ?? '', maxlength: attrs.maxlength || '200', ...(attrs.min ? { min: attrs.min, max: attrs.max } : {}) }))
  const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'mu-file', 'aria-label': 'Choose a picture', onchange: (event) => void pictureFromFile(event.target.files[0]) })
  const form = el(
    'form',
    {
      class: 'mu-edit',
      onsubmit: async (event) => {
        event.preventDefault()
        const f = event.target.elements
        const patch = {
          title: f.title.value, artist: f.artist.value, album: f.album.value, albumArtist: f.albumArtist.value, genre: f.genre.value,
          year: f.year.value.trim() === '' ? null : Number(f.year.value), trackNumber: f.trackNumber.value.trim() === '' ? null : Number(f.trackNumber.value)
        }
        const answer = await run('music:do', ['edit', t.id, patch])
        if (!answer || answer.ok === false) {
          said = answer?.why || problem || 'Those changes could not be saved.'
          draw()
          return
        }
        said = 'Saved.'
        editing = null
        await refresh()
      }
    },
    el('div', { class: 'mu-edit-art' }, artTile(t, 'l'),
      el('div', { class: 'mu-edit-art-actions' },
        el('button', { type: 'button', class: 'mu-cta small', onclick: () => picker.click() }, 'Change artwork'),
        el('button', { type: 'button', class: 'mu-ghost small', onclick: async () => { await run('music:do', ['set-artwork', t.id, null]); delete art[t.id]; artTried.delete(t.id); said = 'Artwork put back to what the file carries.'; await refresh() } }, 'Use the file’s own'),
        picker)),
    field('title', 'Title', t.title),
    field('artist', 'Artist', t.artist),
    field('album', 'Album', t.album),
    field('albumArtist', 'Album artist', t.albumArtist),
    field('genre', 'Genre', t.genre, { maxlength: '80' }),
    el('div', { class: 'mu-smart-years' }, field('year', 'Year', t.year, { type: 'number', min: '1000', max: '3000' }), field('trackNumber', 'Track number', t.trackNumber, { type: 'number', min: '1', max: '999' })),
    el('p', { class: 'music-note' }, 'Changes are kept in your Orbis library. The audio file itself is not touched.'),
    el('div', { class: 'mu-addbar' },
      el('button', { type: 'submit', class: 'mu-cta small' }, 'Save'),
      el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { editing = null; draw() } }, 'Cancel'))
  )
  return el('section', { class: 'mu-library' }, el('h3', { class: 'mu-edit-title' }, 'Edit details'), form)
}

/** "Add to which playlist?", shown over the list the song was chosen from. */
function chooser() {
  if (!pickFor) return null
  const manual = playlists.filter((list) => !list.rule)
  return el(
    'section',
    { class: 'mu-chooser', role: 'dialog', 'aria-label': 'Add to a playlist' },
    el('p', { class: 'mu-chooser-title' }, 'Add to which playlist?'),
    manual.length === 0 ? el('p', { class: 'music-note' }, 'You have no playlists yet. Make one in Playlists, then add songs to it from here.') : null,
    ...manual.map((list) =>
      el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { const track = pickFor; pickFor = null; void act('music:add-to-playlist', [list.id, [track]], `Added to ${list.name}`) } }, list.name)
    ),
    el('button', { type: 'button', class: 'mu-ghost small', onclick: () => { pickFor = null; draw() } }, 'Cancel')
  )
}


/* ---- keeping, moving and tidying ------------------------------------------------------------------------------------ */
function saveText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = el('a', { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function exportKind(kind, withPaths) {
  const out = await run('music:do', ['export', kind, withPaths])
  if (!out || out.ok === false) said = out?.why || problem || 'That could not be exported.'
  else {
    saveText(out.name, out.text, 'application/json')
    said = `Saved ${out.name}.`
  }
  draw()
}

async function importPlaylistFile(file) {
  if (!file) return
  if (file.size > 2_000_000) {
    said = 'That file is too large to be a playlist.'
    draw()
    return
  }
  const out = await run('music:do', ['import-playlist', file.name, await file.text()])
  if (!out || out.ok === false) said = out?.why || problem || 'That playlist could not be read.'
  else said = `Playlist "${out.playlist.name}" made with ${out.matched} ${out.matched === 1 ? 'song' : 'songs'}${out.missing ? `. ${out.missing} in the file ${out.missing === 1 ? 'is' : 'are'} not in your library, so ${out.missing === 1 ? 'it was' : 'they were'} left out.` : '.'}`
  await refresh()
}

function manageView() {
  let withPaths = false
  const filePicker = el('input', { type: 'file', accept: '.m3u,.m3u8,.json,application/json,audio/x-mpegurl', class: 'mu-file', 'aria-label': 'Choose a playlist file', onchange: (event) => void importPlaylistFile(event.target.files[0]) })
  const card = (title, note, ...kids) => el('section', { class: 'mu-smart' }, el('h3', {}, title), el('p', { class: 'music-note' }, note), ...kids)
  return el(
    'section',
    { class: 'mu-library' },
    card('Export', 'Save what Orbis knows as a file. Song names and playlists only; your audio files are not included.',
      el('label', { class: 'mu-check' }, el('input', { type: 'checkbox', onchange: (event) => { withPaths = event.target.checked } }), 'Include where each file is on this computer'),
      el('div', { class: 'mu-presets' },
        el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void exportKind('library', withPaths) }, 'Library index'),
        el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void exportKind('playlists', withPaths) }, 'All playlists'))),
    card('Import a playlist', 'Read a .m3u or .m3u8 playlist, or one exported from Orbis. Songs are matched to your library; nothing is downloaded.',
      el('button', { type: 'button', class: 'mu-cta small', onclick: () => filePicker.click() }, 'Choose a playlist file'), filePicker),
    card('Tidy your files', 'Arrange the music in your watched folders as Artist / Album / Track. Nothing moves until you confirm, and nothing is overwritten.',
      el('button', { type: 'button', class: 'mu-ghost small', onclick: async () => { organisePlan = await run('music:do', ['organise-plan']); draw() } }, 'Show what would change'),
      organisePlan && organisePlan.ok
        ? el('div', { class: 'mu-organise' },
            organisePlan.count === 0
              ? el('p', { class: 'music-note' }, 'Everything is already arranged.')
              : el('div', {},
                  el('p', { class: 'music-note' }, `${organisePlan.count} ${organisePlan.count === 1 ? 'file' : 'files'} would move. For example:`),
                  ...organisePlan.examples.map((m) => el('p', { class: 'mu-move' }, el('span', {}, m.from), el('b', {}, '→ ' + m.to))),
                  el('button', { type: 'button', class: 'mu-cta small', onclick: async () => {
                    if (!window.confirm(`Move ${organisePlan.count} files into Artist / Album folders? This changes files on your computer.`)) return
                    const out = await run('music:do', ['organise-apply', organisePlan.ids, true])
                    organisePlan = null
                    said = out?.ok ? `Moved ${out.moved} ${out.moved === 1 ? 'file' : 'files'}${out.skipped ? `; ${out.skipped} left where they were` : ''}.` : out?.why || problem || 'Nothing was moved.'
                    await refresh()
                  } }, `Move ${organisePlan.count} files`)))
        : null)
  )
}

/** The small player that stays along the bottom while you are anywhere but Now playing. */
function miniPlayer() {
  const playback = state?.playback
  const track = state?.track
  if (!track || playback?.owner === 'website') return null
  const total = Math.max(1, Math.round(playback.duration || track.duration || 1))
  const pct = Math.min(100, Math.round(((playback.position || 0) / total) * 100))
  return el(
    'div',
    { class: 'mu-mini', style: `--p:${pct}%` },
    el('button', { type: 'button', class: 'mu-mini-main', title: 'Open the player', onclick: () => { view = 'now'; void refresh() } }, artTile(track, 's'), el('span', { class: 'mu-row-text' }, el('span', { class: 'music-row-title' }, track.title), el('span', { class: 'music-row-artist' }, track.artist || 'Unknown artist'))),
    iconButton('prev', 'Previous', () => void act('music:previous'), { class: 'small' }),
    iconButton(playback.playing ? 'pause' : 'play', playback.playing ? 'Pause' : 'Play', () => void act(playback.playing ? 'music:pause' : 'music:resume'), { class: 'small primary' }),
    iconButton('next', 'Next', () => void act('music:next'), { class: 'small' }),
    el('span', { class: 'mu-mini-bar', 'aria-hidden': 'true' })
  )
}

/**
 * The DJ, a station, and why this track.
 *
 * "Why this?" is asked of the engine rather than written here, and it shows the real contributions -- so a student
 * can disagree with it. An explanation nobody can check is decoration.
 */
function djStrip() {
  const reasons = why && Array.isArray(why.reasons) ? why.reasons : []
  return el(
    'section',
    { class: 'music-dj' },
    el(
      'div',
      { class: 'music-dj-row' },
      el('span', { class: 'mu-dj-label' }, 'AI DJ'),
      el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void act('music:do', ['dj', true], 'Starting the DJ…') }, 'Start'),
      el('button', { type: 'button', class: 'mu-ghost small', onclick: () => void act('music:do', ['dj', false], 'Stopping the DJ…') }, 'Stop'),
      el(
        'button',
        {
          type: 'button',
          class: 'mu-ghost small',
          onclick: () => void act('music:do', ['radio', state?.track?.id ?? null], 'Starting a station…')
        },
        state?.track?.id ? 'Station from this song' : 'Personal station'
      )
    ),
    reasons.length > 0
      ? el(
          'details',
          { class: 'music-why' },
          el('summary', {}, 'Why this one?'),
          el('ul', {}, ...reasons.slice(0, 6).map((one) => el('li', {}, typeof one === 'string' ? one : `${one.label}: ${one.value}`)))
        )
      : null
  )
}

function draw() {
  if (!root) return
  // Filtered, because replaceChildren puts the word "null" on screen for anything that is not a node.
  const parts = [
    el(
      'div',
      { class: 'music-tabs', role: 'tablist', 'aria-label': 'Orbis Music' },
      ...TABS.map((tab) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `music-tab${view === tab.id ? ' on' : ''}`,
            'aria-selected': String(view === tab.id),
            onclick: () => {
              view = tab.id
              void refresh()
            }
          },
          tab.label
        )
      )
    ),
    problem ? el('p', { class: 'music-problem' }, problem) : null,
    busy ? el('p', { class: 'music-note' }, busy) : null,
    said ? el('p', { class: 'music-said' }, said) : null,
    dropNote ? el('p', { class: 'music-note mu-progress' }, dropNote) : null,
    chooser(),
    editing ? editorView() : null,
    editing ? null : view === 'now' ? nowPlaying() : null,
    !editing && view === 'now' && state?.playback?.owner !== 'website' ? djStrip() : null,
    !editing && view === 'now' && state?.playback?.owner !== 'website' ? addButton() : null,
    !editing && view === 'find' ? findView() : null,
    !editing && view === 'discover' ? discoverView() : null,
    !editing && view === 'library' ? libraryView() : null,
    !editing && view === 'queue' ? queueView() : null,
    !editing && view === 'playlists' ? playlistsView() : null,
    !editing && view === 'recent' ? recentView() : null,
    !editing && view === 'bring' ? bringInView() : null,
    !editing && view === 'manage' ? manageView() : null,
    !editing && view === 'settings' ? settingsView() : null,
    state?.summary && view !== 'now'
      ? el(
          'p',
          { class: 'music-summary' },
          `${state.summary.tracks} ${state.summary.tracks === 1 ? 'song' : 'songs'} · ${state.summary.offline} playable here · ${state.summary.reference} saved by name`
        )
      : null,
    view !== 'now' ? miniPlayer() : null
  ]
  root.replaceChildren(...parts.filter((one) => one !== null && one !== undefined && one !== false))
}


/* ---- dropping songs onto the panel ----------------------------------------------------------------------------------
 *
 * A web page is not told where a dropped file lives, so each file is sent across in pieces and put back together on
 * the Orbis side, where it is read and understood like any other file before it is added.
 */
const AUDIO_ENDING = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wave)$/i
const PIECE = 3 * 1024 * 1024

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

async function sendFile(file, key) {
  let at = 0
  do {
    const end = Math.min(file.size, at + PIECE)
    const data = toBase64(await file.slice(at, end).arrayBuffer())
    const last = end >= file.size
    const answer = await run('music:do', ['drop-chunk', { name: file.name, key, data, last }])
    if (!answer || answer.ok === false) return { ok: false, why: answer?.why || problem || 'That file could not be added.' }
    if (last) return answer
    at = end
  } while (at < file.size)
  return { ok: false, why: 'That file could not be added.' }
}

async function takeDrop(list) {
  const files = [...list]
  if (files.length === 0) return
  const audio = files.filter((file) => AUDIO_ENDING.test(file.name))
  const skipped = files.length - audio.length
  if (audio.length === 0) {
    said = 'Those are not audio files. Orbis plays MP3, FLAC, WAV, M4A, AAC, OGG and Opus.'
    draw()
    return
  }
  let added = 0
  let already = 0
  const failed = []
  for (let i = 0; i < audio.length; i++) {
    dropNote = `Adding ${i + 1} of ${audio.length}: ${audio[i].name}`
    draw()
    const done = await sendFile(audio[i], `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`)
    if (done.ok === false) failed.push(`${audio[i].name} (${done.why})`)
    else {
      added += done.added || 0
      already += done.already || 0
      if ((done.failed || 0) > 0) failed.push(audio[i].name)
    }
  }
  dropNote = ''
  const parts = []
  if (added) parts.push(`${added} ${added === 1 ? 'song' : 'songs'} added`)
  if (already) parts.push(`${already} already in your library`)
  if (skipped) parts.push(`${skipped} not audio, skipped`)
  if (failed.length) parts.push(`could not add: ${failed.slice(0, 3).join(', ')}`)
  said = parts.join(' · ') || 'Nothing was added.'
  if (added) view = view === 'now' ? 'library' : view
  await refresh()
}

function wireDrop() {
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files')
  const shell = document.getElementById('view-music') || root
  shell.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth++
    shell.classList.add('mu-dropping')
  })
  shell.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  })
  shell.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) shell.classList.remove('mu-dropping')
  })
  shell.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth = 0
    shell.classList.remove('mu-dropping')
    void takeDrop(event.dataTransfer.files)
  })
}

/**
 * Kept up to date while the panel is open, and left alone when it is not.
 *
 * The player's position moves by itself, so this asks again every couple of seconds while something is playing and
 * far less often when nothing is. A panel nobody is looking at asks for nothing.
 */
let watching = null
function watch() {
  window.clearInterval(watching)
  watching = window.setInterval(() => {
    if (document.hidden) return
    if (!document.getElementById('view-music') || document.getElementById('view-music').hidden) return
    void refresh()
  }, 2000)
}

wireDrop()
document.addEventListener('orbis:music-shown', () => {
  void refresh()
  watch()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh()
})

if (root) {
  draw()
  void refresh()
  watch()
}

/*
 * And once, now, if this is the view the panel opened at.
 *
 * `showTab` dispatches the event as the page loads for whichever view the address names, which is before this
 * module exists. Landing straight on #music drew an empty screen until somebody navigated away and back.
 */
{
  const here = document.getElementById('view-music')
  if (here && !here.hidden) document.dispatchEvent(new CustomEvent('orbis:music-shown'))
}
