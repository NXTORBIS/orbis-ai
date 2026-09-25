/**
 * The engines behind Orbis's specialized search.
 *
 * Each category goes to a source that actually holds that kind of thing, over that source's own public JSON API. There
 * is no scraping here: nothing parses anybody's search page, and nothing pretends a web result is an image or a paper.
 *
 * Every engine is called directly by Orbis's own code. SearXNG is deliberately not used — it is AGPL, and running it as
 * the service Orbis queries is the case that licence is written about.
 *
 * A category with no engine returns nothing and says so. It never returns web results dressed up as something else: a
 * page about a song is not a song, and answering with one would be a lie told in the interface.
 */

/** The shape the Orbis client reads (see readResult in src/shared/searchProviders.ts). */
export interface EngineResult {
  url: string
  title: string
  content?: string
  thumbnail?: string
  img_src?: string
  img_width?: number
  img_height?: number
  length?: number
  iframe_src?: string
  audio_src?: string
  engine: string
  publishedDate?: string
}

export interface Engine {
  /** Named in `unresponsive_engines` when it fails, so the interface can say which source was quiet. */
  readonly name: string
  search(query: string, signal: AbortSignal): Promise<EngineResult[]>
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const json = async (fetchFn: FetchFn, url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<unknown> => {
  const res = await fetchFn(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'Orbis/1.0 (+https://nxtorbis.ai)', ...headers }
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/**
 * Images: Openverse, the Creative Commons search index. Openly licensed work, with the licence carried through so
 * nobody has to guess what they may do with a picture.
 */
export const openverseImages = (fetchFn: FetchFn): Engine => ({
  name: 'openverse',
  async search(query, signal) {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=40&mature=false`
    const body = obj(await json(fetchFn, url, signal))
    return rows(body.results).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const image = str(r.url)
      const page = str(r.foreign_landing_url) ?? image
      const title = str(r.title) ?? str(r.creator)
      if (!image || !page || !title) return []
      return [{
        url: page,
        title,
        img_src: image,
        ...(str(r.thumbnail) ? { thumbnail: str(r.thumbnail)! } : {}),
        ...(num(r.width) !== undefined ? { img_width: num(r.width)! } : {}),
        ...(num(r.height) !== undefined ? { img_height: num(r.height)! } : {}),
        ...(str(r.license) ? { content: `${str(r.license)!.toUpperCase()}${str(r.creator) ? ` · ${str(r.creator)}` : ''}` } : {}),
        engine: 'openverse'
      }]
    })
  }
})

/** Videos and audio: Openverse holds audio; video comes from Wikimedia Commons, which serves real media files. */
export const openverseAudio = (fetchFn: FetchFn): Engine => ({
  name: 'openverse-audio',
  async search(query, signal) {
    const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&page_size=30&mature=false`
    const body = obj(await json(fetchFn, url, signal))
    return rows(body.results).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const page = str(r.foreign_landing_url) ?? str(r.url)
      const title = str(r.title)
      if (!page || !title) return []
      return [{
        url: page,
        title,
        ...(str(r.url) ? { audio_src: str(r.url)! } : {}),
        ...(str(r.thumbnail) ? { thumbnail: str(r.thumbnail)! } : {}),
        ...(num(r.duration) !== undefined ? { length: Math.round(num(r.duration)! / 1000) } : {}),
        ...(str(r.creator) ? { content: str(r.creator)! } : {}),
        engine: 'openverse-audio'
      }]
    })
  }
})

/** Wikimedia Commons: freely licensed media, searched through the MediaWiki API. */
export const commonsMedia = (fetchFn: FetchFn, mime: 'video' | 'image'): Engine => ({
  name: `commons-${mime}`,
  async search(query, signal) {
    const search = `${query} filetype:${mime}`
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
      `&gsrsearch=${encodeURIComponent(search)}&gsrlimit=30&gsrnamespace=6` +
      `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=320`
    const body = obj(await json(fetchFn, url, signal))
    const pages = obj(obj(body.query).pages)
    return Object.values(pages).flatMap((raw): EngineResult[] => {
      const p = obj(raw)
      const info = obj(rows(p.imageinfo)[0])
      const page = str(info.descriptionurl)
      const title = str(p.title)?.replace(/^File:/, '')
      if (!page || !title) return []
      return [{
        url: page,
        title,
        ...(mime === 'image' && str(info.url) ? { img_src: str(info.url)! } : {}),
        ...(str(info.thumburl) ? { thumbnail: str(info.thumburl)! } : {}),
        ...(mime === 'image' && num(info.width) !== undefined ? { img_width: num(info.width)! } : {}),
        ...(mime === 'image' && num(info.height) !== undefined ? { img_height: num(info.height)! } : {}),
        ...(mime === 'video' && str(info.url) ? { iframe_src: str(info.url)! } : {}),
        engine: `commons-${mime}`
      }]
    })
  }
})


/**
 * News: Wikinews, over the same MediaWiki API Commons uses. Keyless, reliable, and the articles are real published
 * pieces with dates. GDELT covers far more of the world's press but rations requests hard, so it comes second: when it
 * answers, its results are added; when it does not, Wikinews has already answered.
 */
export const wikinews = (fetchFn: FetchFn): Engine => ({
  name: 'wikinews',
  async search(query, signal) {
    const url =
      `https://en.wikinews.org/w/api.php?action=query&format=json&origin=*&generator=search` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=30&gsrnamespace=0` +
      `&prop=info|pageimages|extracts&inprop=url&piprop=thumbnail&pithumbsize=320&exintro=1&explaintext=1`
    const body = obj(await json(fetchFn, url, signal))
    const pages = obj(obj(body.query).pages)
    return Object.values(pages).flatMap((raw): EngineResult[] => {
      const p = obj(raw)
      const page = str(p.fullurl)
      const title = str(p.title)
      if (!page || !title) return []
      return [{
        url: page,
        title,
        ...(str(p.extract) ? { content: str(p.extract)!.slice(0, 400) } : {}),
        ...(str(obj(p.thumbnail).source) ? { thumbnail: str(obj(p.thumbnail).source)! } : {}),
        ...(str(p.touched) ? { publishedDate: str(p.touched)! } : {}),
        engine: 'wikinews'
      }]
    })
  }
})

/** News: GDELT's document index, which covers published news worldwide and answers over JSON. */
/**
 * GDELT asks for no more than one request every five seconds and answers 429 when pressed harder. That is a rule about
 * how to behave, not a fault, so Orbis waits its turn rather than hammering and calling the result "unavailable".
 * Recent answers are kept briefly so a repeated search does not have to wait at all.
 */
const GDELT_MIN_GAP_MS = 5_000
const GDELT_CACHE_MS = 60_000
let gdeltLastCall = 0
const gdeltCache = new Map<string, { at: number; results: EngineResult[] }>()

export const gdeltNews = (fetchFn: FetchFn, now: () => number = Date.now): Engine => ({
  name: 'gdelt',
  async search(query, signal) {
    const cached = gdeltCache.get(query)
    if (cached && now() - cached.at < GDELT_CACHE_MS) return cached.results

    const since = now() - gdeltLastCall
    if (since < GDELT_MIN_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, GDELT_MIN_GAP_MS - since))
      if (signal.aborted) throw new Error('aborted')
    }
    gdeltLastCall = now()

    const url =
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}` +
      `&mode=artlist&maxrecords=40&format=json&sort=datedesc`
    const body = obj(await json(fetchFn, url, signal))
    const results = rows(body.articles).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const url2 = str(r.url)
      const title = str(r.title)
      if (!url2 || !title) return []
      return [{
        url: url2,
        title,
        ...(str(r.socialimage) ? { thumbnail: str(r.socialimage)! } : {}),
        ...(str(r.domain) ? { content: str(r.domain)! } : {}),
        ...(str(r.seendate) ? { publishedDate: str(r.seendate)! } : {}),
        engine: 'gdelt'
      }]
    })
    gdeltCache.set(query, { at: now(), results })
    return results
  }
})

/** Maps: OpenStreetMap's Nominatim, which answers with real places and coordinates. */
export const nominatimMaps = (fetchFn: FetchFn): Engine => ({
  name: 'openstreetmap',
  async search(query, signal) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=25&addressdetails=1`
    const body = await json(fetchFn, url, signal)
    return rows(body).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const title = str(r.display_name)
      const lat = str(r.lat)
      const lon = str(r.lon)
      if (!title || !lat || !lon) return []
      return [{
        url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
        title,
        content: [str(r.type), str(r.category)].filter(Boolean).join(' · ') || undefined,
        engine: 'openstreetmap'
      }]
    })
  }
})

/** Music: MusicBrainz, the open music database. Recordings, with the artist and the release they came from. */
export const musicBrainz = (fetchFn: FetchFn): Engine => ({
  name: 'musicbrainz',
  async search(query, signal) {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=30`
    const body = obj(await json(fetchFn, url, signal))
    return rows(body.recordings).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const id = str(r.id)
      const title = str(r.title)
      if (!id || !title) return []
      const artist = rows(r['artist-credit']).map((a) => str(obj(a).name)).filter(Boolean).join(', ')
      const length = num(r.length)
      return [{
        url: `https://musicbrainz.org/recording/${id}`,
        title,
        ...(artist ? { content: artist } : {}),
        ...(length ? { length: Math.round(length / 1000) } : {}),
        engine: 'musicbrainz'
      }]
    })
  }
})

/** Science: OpenAlex, an open index of scholarly work. Papers, with their authors and where they appeared. */
export const openAlex = (fetchFn: FetchFn): Engine => ({
  name: 'openalex',
  async search(query, signal) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=30&mailto=orbis@nxtorbis.ai`
    const body = obj(await json(fetchFn, url, signal))
    return rows(body.results).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const title = str(r.display_name)
      const landing = str(obj(r.primary_location).landing_page_url) ?? str(r.doi) ?? str(r.id)
      if (!title || !landing) return []
      const authors = rows(r.authorships).slice(0, 4).map((a) => str(obj(obj(a).author).display_name)).filter(Boolean).join(', ')
      const venue = str(obj(obj(r.primary_location).source).display_name)
      const year = num(r.publication_year)
      return [{
        url: landing,
        title,
        content: [authors, venue, year ? String(year) : undefined].filter(Boolean).join(' · ') || undefined,
        ...(str(r.publication_date) ? { publishedDate: str(r.publication_date)! } : {}),
        engine: 'openalex'
      }]
    })
  }
})

/**
 * Science: Crossref, the DOI registry. Beside OpenAlex rather than instead of it — both ration bursts, and a category
 * with one source is a category that empties the moment that source says "not so fast".
 */
export const crossref = (fetchFn: FetchFn): Engine => ({
  name: 'crossref',
  async search(query, signal) {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=30&select=DOI,title,author,issued,container-title,abstract&mailto=orbis@nxtorbis.ai`
    const body = obj(await json(fetchFn, url, signal))
    return rows(obj(body.message).items).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const title = str(rows(r.title)[0])
      const doi = str(r.DOI)
      if (!title || !doi) return []
      const authors = rows(r.author)
        .slice(0, 4)
        .map((a) => [str(obj(a).given), str(obj(a).family)].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ')
      const venue = str(rows(r['container-title'])[0])
      const year = num(rows(rows(obj(r.issued))[0])[0])
      return [{
        url: `https://doi.org/${doi}`,
        title,
        content: [authors, venue, year ? String(year) : undefined].filter(Boolean).join(' · ') || undefined,
        engine: 'crossref'
      }]
    })
  }
})

/** Files: the Internet Archive, which holds real downloadable items rather than pages about them. */
export const internetArchive = (fetchFn: FetchFn): Engine => ({
  name: 'internetarchive',
  async search(query, signal) {
    const url =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
      `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=mediatype&rows=30&page=1&output=json`
    const body = obj(await json(fetchFn, url, signal))
    return rows(obj(body.response).docs).flatMap((raw): EngineResult[] => {
      const r = obj(raw)
      const id = str(r.identifier)
      const title = str(r.title)
      if (!id || !title) return []
      const description = Array.isArray(r.description) ? str(r.description[0]) : str(r.description)
      return [{
        url: `https://archive.org/details/${id}`,
        title,
        ...(description ? { content: description } : {}),
        ...(str(r.mediatype) ? { thumbnail: `https://archive.org/services/img/${id}` } : {}),
        engine: 'internetarchive'
      }]
    })
  }
})

/** Social: Lemmy's open API — federated discussion, answering over JSON without a key. */
export const lemmySocial = (fetchFn: FetchFn): Engine => ({
  name: 'lemmy',
  async search(query, signal) {
    const url = `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts&sort=TopAll&limit=30`
    const body = obj(await json(fetchFn, url, signal))
    return rows(body.posts).flatMap((raw): EngineResult[] => {
      const entry = obj(raw)
      const post = obj(entry.post)
      const title = str(post.name)
      const id = num(post.id)
      if (!title || id === undefined) return []
      const community = str(obj(entry.community).name)
      const counts = obj(entry.counts)
      const score = num(counts.score)
      return [{
        url: str(post.ap_id) ?? `https://lemmy.world/post/${id}`,
        title,
        content: [community ? `!${community}` : undefined, score !== undefined ? `${score} points` : undefined]
          .filter(Boolean)
          .join(' · ') || undefined,
        ...(str(post.thumbnail_url) ? { thumbnail: str(post.thumbnail_url)! } : {}),
        ...(str(post.published) ? { publishedDate: str(post.published)! } : {}),
        engine: 'lemmy'
      }]
    })
  }
})

/** Which engines answer which category. The names here are the ones the client reports when a source is quiet. */
export function enginesFor(category: string, fetchFn: FetchFn): Engine[] {
  switch (category) {
    case 'images':
      // Openverse answers 401 to anonymous callers, so it is not asked. Commons
      // carries this category on its own; an engine that always fails is noise.
      return [commonsMedia(fetchFn, 'image')]
    case 'videos':
      return [commonsMedia(fetchFn, 'video')]
    case 'news':
      return [wikinews(fetchFn), gdeltNews(fetchFn)]
    case 'map':
      return [nominatimMaps(fetchFn)]
    case 'music':
      return [musicBrainz(fetchFn)]
    case 'science':
      return [openAlex(fetchFn), crossref(fetchFn)]
    case 'files':
      return [internetArchive(fetchFn)]
    case 'social media':
      return [lemmySocial(fetchFn)]
    default:
      return []
  }
}
