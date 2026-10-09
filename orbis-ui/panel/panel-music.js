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

async function refresh() {
  const next = await run('music:state')
  if (next) state = next
  heard = await run('music:heard')
  if (view === 'library' || view === 'now') library = (await run('music:search', [{ search, sort: 'added' }])) ?? library
  if (view === 'playlists') playlists = (await run('music:playlists')) ?? playlists
  if (view === 'recent') recent = (await run('music:recent')) ?? recent
  if (view === 'discover' && explorations.length === 0) explorations = (await ask('explorations')) ?? []
  if (view === 'discover') dna = (await ask('dna')) ?? dna
  if (view === 'bring') await refreshBring()
  if (view === 'settings' && sources.length === 0) sources = (await ask('sources')) ?? []
  if (view === 'now' && state?.track?.id) why = (await ask('why', state.track.id)) ?? null
  draw()
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
      { class: 'music-now website' },
      el('p', { class: 'music-source' }, 'Playing on a web page'),
      el('p', { class: 'music-title' }, names ? `${names.title}${names.artist ? ` — ${names.artist}` : ''}` : 'Something on this page'),
      el('p', { class: 'music-note' }, 'That player belongs to the page. Orbis leaves it alone.'),
      addButton()
    )
  }

  if (!track) {
    return el(
      'section',
      { class: 'music-now empty' },
      el('p', { class: 'music-title' }, 'Nothing is playing'),
      el('p', { class: 'music-note' }, library.length ? 'Pick something from your library.' : 'Import your own music from the Orbis window, or recognise a song while you browse.')
    )
  }

  const bar = el('input', {
    type: 'range',
    class: 'music-seek',
    min: '0',
    max: String(Math.max(1, Math.round(playback.duration || track.duration || 1))),
    value: String(Math.round(playback.position || 0)),
    'aria-label': 'Where you are in the track',
    oninput: (event) => void act('music:seek', [Number(event.target.value)])
  })

  return el(
    'section',
    { class: 'music-now' },
    el('p', { class: 'music-source' }, 'Playing from Orbis Music'),
    el('p', { class: 'music-title' }, track.title),
    el('p', { class: 'music-artist' }, [track.artist, track.album].filter(Boolean).join(' — ') || 'Unknown artist'),
    el('div', { class: 'music-times' }, el('span', {}, length(playback.position)), bar, el('span', {}, length(playback.duration || track.duration))),
    el(
      'div',
      { class: 'music-controls' },
      el('button', { type: 'button', class: 'music-btn', title: 'Shuffle', 'aria-pressed': String(Boolean(playback.shuffle)), onclick: () => void act('music:shuffle', [!playback.shuffle]) }, 'Shuffle'),
      el('button', { type: 'button', class: 'music-btn', title: 'Previous', onclick: () => void act('music:previous') }, 'Previous'),
      el('button', { type: 'button', class: 'music-btn primary', onclick: () => void act(playback.playing ? 'music:pause' : 'music:resume') }, playback.playing ? 'Pause' : 'Play'),
      el('button', { type: 'button', class: 'music-btn', title: 'Next', onclick: () => void act('music:next') }, 'Next'),
      el(
        'button',
        { type: 'button', class: 'music-btn', title: 'Repeat', onclick: () => void act('music:repeat', [playback.repeat === 'off' ? 'all' : playback.repeat === 'all' ? 'one' : 'off']) },
        playback.repeat === 'one' ? 'Repeat one' : playback.repeat === 'all' ? 'Repeat all' : 'Repeat off'
      ),
      el('button', { type: 'button', class: 'music-btn', 'aria-pressed': String(Boolean(track.favourite)), onclick: () => void act('music:favourite', [track.id, !track.favourite]) }, track.favourite ? 'Favourite ✓' : 'Favourite')
    ),
    el(
      'div',
      { class: 'music-volume' },
      el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:mute', [!playback.muted]) }, playback.muted ? 'Unmute' : 'Mute'),
      el('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round((playback.volume ?? 1) * 100)),
        'aria-label': 'Volume',
        oninput: (event) => void act('music:volume', [Number(event.target.value) / 100])
      })
    ),
    playback.problem ? el('p', { class: 'music-problem' }, playback.problem) : null
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
  return el(
    'li',
    { class: `music-row${state?.playback?.trackId === track.id ? ' playing' : ''}` },
    el(
      'button',
      {
        type: 'button',
        class: 'music-row-play',
        title: where.tone === 'good' ? `Play ${track.title}` : where.label,
        onclick: () => void act(queue ? 'music:play' : 'music:play', [track.id])
      },
      el('span', { class: 'music-row-title' }, track.title),
      el('span', { class: 'music-row-artist' }, [track.artist, track.album].filter(Boolean).join(' — ') || 'Unknown artist')
    ),
    el('span', { class: 'music-row-length' }, length(track.duration)),
    el('span', { class: `music-row-where ${where.tone}` }, where.label),
    el('button', { type: 'button', class: 'music-row-act', 'aria-pressed': String(Boolean(track.favourite)), title: 'Favourite', onclick: () => void act('music:favourite', [track.id, !track.favourite]) }, '♥'),
    el('button', { type: 'button', class: 'music-row-act', title: 'Add to the queue', onclick: () => void act('music:queue-end', [[track.id]]) }, '+'),
    typeof index === 'number' ? el('button', { type: 'button', class: 'music-row-act', title: 'Take out of the queue', onclick: () => void act('music:queue-remove', [index]) }, '×') : null
  )
}

function libraryView() {
  const box = el('input', {
    type: 'search',
    class: 'music-search',
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
    { class: 'music-controls' },
    el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:import', [], 'Choose files in the Orbis window…') }, 'Add files'),
    el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:scan-folder', [], 'Choose a folder in the Orbis window…') }, 'Add a folder')
  )

  if (library.length === 0) {
    return el(
      'section',
      { class: 'music-list' },
      box,
      bringIn,
      el(
        'p',
        { class: 'music-note' },
        search ? `Nothing in your music matches "${search}".` : 'Your music is empty. Recognise a song while you browse, or add your own files.'
      )
    )
  }
  return el('section', { class: 'music-list' }, box, bringIn, el('ul', { class: 'music-rows' }, ...library.map((track) => trackRow(track))))
}

function queueView() {
  const queue = state?.queue ?? []
  if (queue.length === 0) return el('section', { class: 'music-list' }, el('p', { class: 'music-note' }, 'The queue is empty.'))
  return el(
    'section',
    { class: 'music-list' },
    el('div', { class: 'music-list-head' }, el('span', {}, `${queue.length} in the queue`), el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:queue-clear') }, 'Clear')),
    el('ul', { class: 'music-rows' }, ...queue.map((track, index) => trackRow(track, index, true)))
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
    el('button', { type: 'submit', class: 'music-btn' }, 'Create')
  )
  if (playlists.length === 0) return el('section', { class: 'music-list' }, make, el('p', { class: 'music-note' }, 'No playlists yet.'))
  return el(
    'section',
    { class: 'music-list' },
    make,
    el(
      'ul',
      { class: 'music-rows' },
      ...playlists.map((list) =>
        el(
          'li',
          { class: 'music-bring-row' },
          el('button', { type: 'button', class: 'music-row-play', onclick: () => void act('music:play-playlist', [list.id]) }, el('span', { class: 'music-row-title' }, list.name), el('span', { class: 'music-row-artist' }, `${list.tracks.length} ${list.tracks.length === 1 ? 'track' : 'tracks'}${list.rule ? ' · worked out' : ''}`))
        )
      )
    )
  )
}

function recentView() {
  if (recent.length === 0) return el('section', { class: 'music-list' }, el('p', { class: 'music-note' }, 'Nothing has been played through Orbis Music yet.'))
  return el('section', { class: 'music-list' }, el('ul', { class: 'music-rows' }, ...recent.map((track) => trackRow(track))))
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
  { id: 'find', label: 'Find' },
  { id: 'discover', label: 'Discover' },
  { id: 'library', label: 'Library' },
  { id: 'queue', label: 'Queue' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'recent', label: 'Recently played' },
  { id: 'bring', label: 'Bring music in' },
  { id: 'settings', label: 'Settings' }
]

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
      el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:do', ['dj', true], 'Starting the DJ…') }, 'AI DJ on'),
      el('button', { type: 'button', class: 'music-btn', onclick: () => void act('music:do', ['dj', false], 'Stopping the DJ…') }, 'Off'),
      el(
        'button',
        {
          type: 'button',
          class: 'music-btn',
          onclick: () => void act('music:do', ['radio', state?.track?.id ?? null], 'Starting a station…')
        },
        state?.track?.id ? 'Station from this' : 'Personal station'
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
    view === 'now' ? nowPlaying() : null,
    view === 'now' && state?.playback?.owner !== 'website' ? djStrip() : null,
    view === 'now' && state?.playback?.owner !== 'website' ? addButton() : null,
    view === 'find' ? findView() : null,
    view === 'discover' ? discoverView() : null,
    view === 'library' ? libraryView() : null,
    view === 'queue' ? queueView() : null,
    view === 'playlists' ? playlistsView() : null,
    view === 'recent' ? recentView() : null,
    view === 'bring' ? bringInView() : null,
    view === 'settings' ? settingsView() : null,
    state?.summary
      ? el(
          'p',
          { class: 'music-summary' },
          `${state.summary.tracks} ${state.summary.tracks === 1 ? 'track' : 'tracks'} · ${state.summary.offline} playable here · ${state.summary.reference} saved by name`
        )
      : null
  ]
  root.replaceChildren(...parts.filter((one) => one !== null && one !== undefined && one !== false))
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
